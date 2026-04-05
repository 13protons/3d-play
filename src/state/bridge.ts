/**
 * Worker bridge — manages worker lifecycle, routes commands, relays messages.
 * All worker communication flows through here.
 */

import { useTrajectoriesStore } from './trajectories'
import { useInputStore } from './input'
import type { BodyMeta } from './trajectories'

let orbitalWorker: Worker | null = null
let animFrameId: number | null = null

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

  // Handle messages from the worker
  orbitalWorker.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'trajectories') {
      useTrajectoriesStore.getState().updateCurves(msg.curves, msg.simTime)
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
      useTrajectoriesStore.getState().setWarpRate(cmd.rate)
    }
    // Vehicle commands would route to the vehicle worker (future)
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
  useTrajectoriesStore.getState().reset()
}
