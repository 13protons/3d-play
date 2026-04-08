/**
 * Worker bridge — manages worker lifecycle, routes commands, relays messages.
 * All worker communication flows through here.
 */

import { useTrajectoriesStore } from './trajectories'
import { useInputStore } from './input'
import type { BodyMeta } from './trajectories'
import type { GravitySource } from '../sim/types'
import { G } from '../sim/constants'

let orbitalWorker: Worker | null = null
let animFrameId: number | null = null
let vehicleWorker: Worker | null = null

export async function startSim(scenarioId: string): Promise<void> {
  // Load scenario
  const scenarioResp = await fetch(`/data/scenarios/${scenarioId}.json`)
  if (!scenarioResp.ok) {
    throw new Error(`Failed to load scenario: ${scenarioId} (${scenarioResp.status})`)
  }
  const scenario = await scenarioResp.json()

  // Load body definitions referenced by the scenario
  const bodyIds = Object.keys(scenario.bodies)
  const bodyDefs = await Promise.all(
    bodyIds.map(async (id: string) => {
      const resp = await fetch(`/data/bodies/${id}.json`)
      if (!resp.ok) throw new Error(`Failed to load body: ${id} (${resp.status})`)
      return resp.json()
    }),
  )

  // Populate body metadata in the trajectory store (for the renderer)
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
      }
    },
  )
  useTrajectoriesStore.getState().setBodies(bodyMetas)

  // Spawn the orbital worker
  orbitalWorker = new Worker(
    new URL('../sim/orbital/worker.ts', import.meta.url),
    { type: 'module' },
  )

  // Promise that resolves when the orbital worker sends its first message
  // (indicating it is initialized and ticking)
  let resolveOrbitalReady: () => void
  const orbitalReady = new Promise<void>((resolve) => {
    resolveOrbitalReady = resolve
  })

  // Handle messages from the orbital worker
  orbitalWorker.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'trajectories') {
      useTrajectoriesStore.getState().updateCurves(msg.curves, msg.simTime)
      resolveOrbitalReady()

      // Relay body positions to vehicle worker as gravity sources
      if (vehicleWorker) {
        const bodyMap = useTrajectoriesStore.getState().bodies
        const sources: GravitySource[] = msg.curves
          .filter((c: { id: string }) => bodyMap[c.id])
          .map((c: { id: string; p1: [number, number, number]; v1: [number, number, number] }) => ({
            gm: G * bodyMap[c.id].mass,
            position: c.p1,
            velocity: c.v1,
          }))
        vehicleWorker.postMessage({ type: 'gravity-sources', bodies: sources, simTime: msg.simTime })
      }
    }
  }

  // Send initialization data to the worker (physics only, no render data)
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
        radius: physics.radius,
        soiRadius: physics.soiRadius,
        position: scenarioBody.position,
        velocity: scenarioBody.velocity,
      }
    }),
  })

  // Load and start vehicle worker if scenario has vehicles
  const vehicles = scenario.vehicles ?? []
  if (vehicles.length > 0) {
    const vehicleMetas = vehicles.map((v: Record<string, unknown>) => ({
      id: v.id, name: v.name, parentId: v.parentId, mesh: v.mesh,
    }))
    useTrajectoriesStore.getState().setVehicles(vehicleMetas)

    // Wait for orbital worker to be ready before spawning vehicle worker
    await orbitalReady

    // Build initial gravity sources from scenario body data
    const initialSources: GravitySource[] = bodyDefs.map(
      (def: Record<string, unknown>) => {
        const physics = def.physics as Record<string, unknown>
        const bodyId = def.id as string
        const scenarioBody = scenario.bodies[bodyId]
        const pos = scenarioBody.position
        return {
          gm: G * (physics.mass as number),
          position: [
            (pos.sector[0] as number) * 1_000_000 + (pos.local[0] as number),
            (pos.sector[1] as number) * 1_000_000 + (pos.local[1] as number),
            (pos.sector[2] as number) * 1_000_000 + (pos.local[2] as number),
          ] as [number, number, number],
          velocity: scenarioBody.velocity as [number, number, number],
        }
      },
    )

    const v = vehicles[0]

    vehicleWorker = new Worker(
      new URL('../sim/vehicle/worker.ts', import.meta.url),
      { type: 'module' },
    )

    vehicleWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'vehicle-trajectories') {
        useTrajectoriesStore.getState().mergeCurves(msg.curves)
      }
    }

    vehicleWorker.postMessage({
      type: 'init',
      vehicle: { id: v.id, position: v.position, velocity: v.velocity },
      gravitySources: initialSources,
      warpRate: 1,
    })
  }

  // Start the command-flush loop on each animation frame
  function loop() {
    flushCommands()
    animFrameId = requestAnimationFrame(loop)
  }
  animFrameId = requestAnimationFrame(loop)
}

function flushCommands(): void {
  if (!orbitalWorker) return
  const commands = useInputStore.getState().drain()
  for (const cmd of commands) {
    if (cmd.type === 'set-warp') {
      orbitalWorker.postMessage({ type: 'set-warp', rate: cmd.rate })
      vehicleWorker?.postMessage({ type: 'set-warp', rate: cmd.rate })
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
  useTrajectoriesStore.getState().reset()
}
