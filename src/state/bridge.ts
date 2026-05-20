/**
 * Worker bridge — owns simulation clock, manages worker lifecycle,
 * routes commands, orchestrates sequential advance: orbital -> vehicle.
 */

import { useTrajectoriesStore } from './trajectories'
import { useInputStore } from './input'
import { useVehicleStore } from './vehicle'
import type { BodyMeta } from './trajectories'
import type { VehicleAero, VehicleResources } from '../sim/types'
import type { TrajectoryCurve } from '../sim/types'
import { G } from '../sim/constants'
import {
  jplEclipticToAppYUpVector,
  vectorToSectorPosition,
} from '../sim/ephemeris'

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

function sectorPositionToVector(position: {
  sector: [number, number, number]
  local: [number, number, number]
}): [number, number, number] {
  return [
    position.sector[0] * 1_000_000 + position.local[0],
    position.sector[1] * 1_000_000 + position.local[1],
    position.sector[2] * 1_000_000 + position.local[2],
  ]
}

function subtractVector(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function addVector(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export async function startSim(scenarioId: string): Promise<void> {
  useVehicleStore.getState().reset()
  const scenarioResp = await fetch(`/data/scenarios/${scenarioId}.json`)
  if (!scenarioResp.ok) {
    throw new Error(`Failed to load scenario: ${scenarioId} (${scenarioResp.status})`)
  }
  const scenario = await scenarioResp.json()
  const isJplEclipticFrame = scenario.coordinateFrame === 'jpl-ecliptic'

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
        gm: (physics.gm as number | undefined) ?? G * (physics.mass as number),
        radius: physics.radius as number,
        axialTilt: physics.axialTilt as number,
        angularVelocity: physics.angularVelocity as number,
        rotationPhase: (scenario.bodies[def.id as string].rotationPhase as number | undefined) ?? 0,
        color: render.color as string,
        texture: render.texture as string | undefined,
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
  const bodySurfaces = bodyDefs.map((def: Record<string, unknown>) => {
    const physics = def.physics as Record<string, unknown>
    return [
      def.id as string,
      physics.radius as number,
      physics.angularVelocity as number,
      physics.axialTilt as number,
      def.atmosphere as VehicleWorkerAtmosphere | undefined,
    ] as [string, number, number, number, VehicleWorkerAtmosphere | undefined]
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
      const position = isJplEclipticFrame
        ? vectorToSectorPosition(
            jplEclipticToAppYUpVector(
              sectorPositionToVector(scenarioBody.position),
            ),
          )
        : scenarioBody.position
      const velocity = isJplEclipticFrame
        ? jplEclipticToAppYUpVector(scenarioBody.velocity)
        : scenarioBody.velocity
      return {
        id: bodyId,
        name: def.name,
        parentId: def.parentId,
        mass: physics.mass,
        gm: (physics.gm as number | undefined) ?? G * (physics.mass as number),
        radius: physics.radius,
        soiRadius: physics.soiRadius,
        position,
        velocity,
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
    for (const v of vehicles as Record<string, unknown>[]) {
      if (v.resources) {
        const resourcesInput = v.resources as { dryMass: number; fuelMass: number }
        const resources: VehicleResources = {
          ...resourcesInput,
          mass: resourcesInput.dryMass + resourcesInput.fuelMass,
        }
        useVehicleStore.getState().setVehicleModel(v.id as string, {
          resources,
          aero: v.aero as VehicleAero | undefined,
        })
      }
    }

    await orbitalReady

    const v = vehicles[0]
    let vehiclePosition = v.position
    let vehicleVelocity = v.velocity
    if (isJplEclipticFrame) {
      const parentBody = scenario.bodies[v.parentId as string]
      const parentRawPosition = sectorPositionToVector(parentBody.position)
      const vehicleRawPosition = sectorPositionToVector(v.position)
      const localPosition = subtractVector(vehicleRawPosition, parentRawPosition)
      const parentAppPosition = jplEclipticToAppYUpVector(parentRawPosition)
      const parentAppVelocity = jplEclipticToAppYUpVector(parentBody.velocity)
      const localVelocity = subtractVector(v.velocity, parentBody.velocity)

      vehiclePosition = vectorToSectorPosition(addVector(parentAppPosition, localPosition))
      vehicleVelocity = addVector(parentAppVelocity, localVelocity)
    }

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
      if (msg.type === 'vehicle-controls') {
        useTrajectoriesStore.getState().setVehicleControl(msg.id, {
          throttle: msg.throttle,
          orientation: msg.orientation,
          angularVelocity: msg.angularVelocity,
          surfaceState: msg.surfaceState,
          aeroForceWorld: msg.aeroForceWorld,
        })
      }
    }

    vehicleWorker.postMessage({
      type: 'init',
      vehicle: { id: v.id, parentId: v.parentId, position: vehiclePosition, velocity: vehicleVelocity },
      bodyCurves: latestOrbitalCurves,
      bodyGMs,
      bodySurfaces,
      resources: useVehicleStore.getState().models[v.id as string]?.resources,
      aero: useVehicleStore.getState().models[v.id as string]?.aero,
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
      if (vehicleWorker) vehicleWorker.postMessage({ type: 'set-warp', rate: cmd.rate })
    }
    if (cmd.type === 'set-throttle' && vehicleWorker) {
      vehicleWorker.postMessage({ type: 'set-throttle', value: cmd.value })
    }
    if (cmd.type === 'set-attitude' && vehicleWorker) {
      vehicleWorker.postMessage({
        type: 'set-attitude',
        pitch: cmd.pitch,
        yaw: cmd.yaw,
        roll: cmd.roll,
      })
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
  useVehicleStore.getState().reset()
}

type VehicleWorkerAtmosphere = {
  loadRadiusMultiplier: number
  model: 'exponential'
  surfaceDensity: number
  scaleHeight: number
  maxAltitude: number
}
