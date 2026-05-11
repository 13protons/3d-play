/**
 * Worker bridge — owns simulation clock, manages worker lifecycle,
 * routes commands, orchestrates sequential advance: orbital -> vehicle.
 */

import { useTrajectoriesStore } from './trajectories'
import { useInputStore } from './input'
import type { BodyMeta } from './trajectories'
import type { TrajectoryCurve } from '../sim/types'
import { G } from '../sim/constants'

let orbitalWorker: Worker | null = null
let vehicleWorker: Worker | null = null
let animFrameId: number | null = null

// Bridge-owned clock
let simTime = 0
let warpRate = 1
let lastWallTime = 0

// Worker state machine
type WorkerState = 'idle' | 'busy'
let orbitalState: WorkerState = 'idle'
let vehicleState: WorkerState = 'idle'

// Pending vehicle dispatch (waiting for orbital to finish)
let pendingTargetTime: number | null = null

// Body metadata for computing G*M
let bodyGMs: [string, number][] = []

// Latest orbital curves (forwarded to vehicle worker)
let latestOrbitalCurves: TrajectoryCurve[] = []

export async function startSim(scenarioId: string): Promise<void> {
  const scenarioResp = await fetch(`/data/scenarios/${scenarioId}.json`)
  if (!scenarioResp.ok) {
    throw new Error(`Failed to load scenario: ${scenarioId} (${scenarioResp.status})`)
  }
  const scenario = await scenarioResp.json()

  const bodyIds = Object.keys(scenario.bodies)
  const bodyDefs = await Promise.all(
    bodyIds.map(async (id: string) => {
      const resp = await fetch(`/data/bodies/${id}.json`)
      if (!resp.ok) throw new Error(`Failed to load body: ${id} (${resp.status})`)
      return resp.json()
    }),
  )

  // Populate body metadata in the trajectory store
  const bodyMetas: BodyMeta[] = bodyDefs.map(
    (def: Record<string, unknown>) => {
      const physics = def.physics as Record<string, unknown>
      const render = def.render as Record<string, unknown>
      return {
        id: def.id as string,
        name: def.name as string,
        parentId: def.parentId as string | null,
        mass: physics.mass as number,
        radius: physics.radius as number,
        color: render.color as string,
        emissive: (render.emissive as boolean) ?? false,
        minimumLight: (render.minimumLight as number | undefined) ?? 0,
      }
    },
  )
  useTrajectoriesStore.getState().setBodies(bodyMetas)

  // Compute G*M pairs for vehicle gravity
  bodyGMs = bodyDefs.map((def: Record<string, unknown>) => {
      const physics = def.physics as Record<string, unknown>
      return [
        def.id as string,
        (physics.gm as number | undefined) ?? G * (physics.mass as number),
      ] as [string, number]
  })

  // Spawn the orbital worker
  orbitalWorker = new Worker(
    new URL('../sim/orbital/worker.ts', import.meta.url),
    { type: 'module' },
  )

  let resolveOrbitalReady: () => void
  const orbitalReady = new Promise<void>((resolve) => {
    resolveOrbitalReady = resolve
  })

  orbitalWorker.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'trajectories') {
      useTrajectoriesStore.getState().updateCurves(msg.curves, msg.simTime)
      latestOrbitalCurves = msg.curves
      orbitalState = 'idle'
      resolveOrbitalReady()

      // Dispatch vehicle worker now that orbital is done
      if (vehicleWorker && pendingTargetTime !== null) {
        dispatchVehicle(pendingTargetTime)
        pendingTargetTime = null
      }
    }
  }

  // Send init to orbital worker
  orbitalWorker.postMessage({
    type: 'init',
    bodies: bodyDefs.map((def: Record<string, unknown>) => {
      const physics = def.physics as Record<string, unknown>
      const bodyId = def.id as string
      const scenarioBody = scenario.bodies[bodyId]
      return {
        id: bodyId,
        name: def.name,
        parentId: def.parentId,
        mass: physics.mass,
        gm: (physics.gm as number | undefined) ?? G * (physics.mass as number),
        radius: physics.radius,
        soiRadius: physics.soiRadius,
        position: scenarioBody.position,
        velocity: scenarioBody.velocity,
      }
    }),
  })

  // Load vehicles
  const vehicles = scenario.vehicles ?? []
  if (vehicles.length > 0) {
    const vehicleMetas = vehicles.map((v: Record<string, unknown>) => ({
      id: v.id, name: v.name, parentId: v.parentId, mesh: v.mesh,
    }))
    useTrajectoriesStore.getState().setVehicles(vehicleMetas)

    await orbitalReady

    const v = vehicles[0]

    vehicleWorker = new Worker(
      new URL('../sim/vehicle/worker.ts', import.meta.url),
      { type: 'module' },
    )

    vehicleWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'vehicle-trajectories') {
        useTrajectoriesStore.getState().mergeCurves(msg.curves)
        vehicleState = 'idle'
      }
    }

    vehicleWorker.postMessage({
      type: 'init',
      vehicle: { id: v.id, position: v.position, velocity: v.velocity },
      bodyCurves: latestOrbitalCurves,
      bodyGMs,
    })
  }

  // Start the bridge clock loop
  simTime = 0
  warpRate = 1
  lastWallTime = performance.now()

  function loop() {
    const now = performance.now()
    const wallDelta = (now - lastWallTime) / 1000
    lastWallTime = now

    // Flush input commands (warp changes)
    flushCommands()

    // Compute target time
    const simDelta = wallDelta * warpRate
    const targetTime = simTime + simDelta

    // Dispatch orbital worker if idle
    if (orbitalWorker && orbitalState === 'idle') {
      orbitalState = 'busy'
      pendingTargetTime = vehicleWorker ? targetTime : null
      orbitalWorker.postMessage({ type: 'advance', targetTime })
      simTime = targetTime
    }
    // If orbital is busy, the renderer interpolates existing curves

    animFrameId = requestAnimationFrame(loop)
  }
  animFrameId = requestAnimationFrame(loop)
}

function dispatchVehicle(targetTime: number): void {
  if (!vehicleWorker || vehicleState !== 'idle') return
  vehicleState = 'busy'
  vehicleWorker.postMessage({
    type: 'advance',
    targetTime,
    bodyCurves: latestOrbitalCurves,
  })
}

function flushCommands(): void {
  const commands = useInputStore.getState().drain()
  for (const cmd of commands) {
    if (cmd.type === 'set-warp') {
      warpRate = cmd.rate
      useTrajectoriesStore.getState().setWarpRate(cmd.rate)
    }
  }
}

export function stopSim(): void {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
  if (orbitalWorker) {
    orbitalWorker.terminate()
    orbitalWorker = null
  }
  if (vehicleWorker) {
    vehicleWorker.terminate()
    vehicleWorker = null
  }
  simTime = 0
  warpRate = 1
  orbitalState = 'idle'
  vehicleState = 'idle'
  pendingTargetTime = null
  latestOrbitalCurves = []
  useTrajectoriesStore.getState().reset()
}
