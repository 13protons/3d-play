/**
 * Worker bridge — manages worker lifecycle, routes commands, relays messages.
 * All worker communication flows through here.
 */

import { useTrajectoriesStore } from './trajectories'
import { useInputStore } from './input'
import type { BodyMeta } from './trajectories'
import { computeCubeBounds, isInsideInnerBox, CP_MIN_X, CP_MIN_Y, CP_MIN_Z, CP_MAX_X, CP_MAX_Y, CP_MAX_Z, CP_G_NEG_X, CP_GRAVITY_SIZE } from '../sim/cube-patch'
import { toAbsolute } from '../sim/coordinates'

let orbitalWorker: Worker | null = null
let animFrameId: number | null = null
let vehicleWorker: Worker | null = null
let currentPatch: Float64Array | null = null
let lastVehiclePosition: [number, number, number] | null = null
let lastVehicleVelocity: [number, number, number] | null = null
let pendingPatchResolve: ((gravityVectors: [number, number, number][]) => void) | null = null
// pendingBounds tracks the bounds of the in-flight patch request (for debugging)
let pendingBounds: [number, number, number, number, number, number] | null = null
void pendingBounds

const DT = 1 / 60

function faceCenterPoints(
  bounds: [number, number, number, number, number, number],
): [number, number, number][] {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  return [
    [minX, cy, cz], // -X
    [maxX, cy, cz], // +X
    [cx, minY, cz], // -Y
    [cx, maxY, cz], // +Y
    [cx, cy, minZ], // -Z
    [cx, cy, maxZ], // +Z
  ]
}

function assemblePatch(
  bounds: [number, number, number, number, number, number],
  gravityVectors: [number, number, number][],
): Float64Array {
  const patch = new Float64Array(CP_GRAVITY_SIZE)
  patch[CP_MIN_X] = bounds[0]; patch[CP_MIN_Y] = bounds[1]; patch[CP_MIN_Z] = bounds[2]
  patch[CP_MAX_X] = bounds[3]; patch[CP_MAX_Y] = bounds[4]; patch[CP_MAX_Z] = bounds[5]
  for (let i = 0; i < 6; i++) {
    const base = CP_G_NEG_X + i * 3
    patch[base] = gravityVectors[i][0]
    patch[base + 1] = gravityVectors[i][1]
    patch[base + 2] = gravityVectors[i][2]
  }
  return patch
}

function requestPatchFromOrbital(
  bounds: [number, number, number, number, number, number],
): Promise<Float64Array> {
  return new Promise((resolve) => {
    pendingBounds = bounds
    pendingPatchResolve = (gravityVectors) => {
      const patch = assemblePatch(bounds, gravityVectors)
      currentPatch = patch
      resolve(patch)
    }
    const points = faceCenterPoints(bounds)
    orbitalWorker!.postMessage({ type: 'request-patch', points })
  })
}

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
    }
    if (msg.type === 'cube-patch-response' && pendingPatchResolve) {
      pendingPatchResolve(msg.gravityVectors)
      pendingPatchResolve = null
      pendingBounds = null
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

    // Wait for orbital worker to be ready before requesting the initial patch
    await orbitalReady

    const v = vehicles[0]
    const vAbs = toAbsolute(v.position)
    const speed = Math.sqrt(v.velocity[0] ** 2 + v.velocity[1] ** 2 + v.velocity[2] ** 2)
    const initialBounds = computeCubeBounds(vAbs[0], vAbs[1], vAbs[2], speed, 1, DT)
    const initialPatch = await requestPatchFromOrbital(initialBounds)

    vehicleWorker = new Worker(
      new URL('../sim/vehicle/worker.ts', import.meta.url),
      { type: 'module' },
    )

    vehicleWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'vehicle-trajectories') {
        useTrajectoriesStore.getState().updateCurves(msg.curves, msg.simTime)
      }
      if (msg.type === 'vehicle-position') {
        lastVehiclePosition = msg.position
        lastVehicleVelocity = msg.velocity
      }
    }

    vehicleWorker.postMessage({
      type: 'init',
      vehicle: { id: v.id, position: v.position, velocity: v.velocity },
      cubePatch: initialPatch,
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
    // Vehicle commands would route to the vehicle worker (future)
  }

  // Inner-box monitoring: refresh cube patch when vehicle leaves inner box
  if (vehicleWorker && currentPatch && lastVehiclePosition && lastVehicleVelocity && !pendingPatchResolve) {
    const [px, py, pz] = lastVehiclePosition
    if (!isInsideInnerBox(currentPatch, px, py, pz)) {
      const speed = Math.sqrt(lastVehicleVelocity[0] ** 2 + lastVehicleVelocity[1] ** 2 + lastVehicleVelocity[2] ** 2)
      const { warpRate } = useTrajectoriesStore.getState()
      const bounds = computeCubeBounds(px, py, pz, speed, warpRate, DT)
      requestPatchFromOrbital(bounds).then((patch) => {
        vehicleWorker?.postMessage({ type: 'cube-patch', data: patch })
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
  currentPatch = null
  lastVehiclePosition = null
  lastVehicleVelocity = null
  pendingPatchResolve = null
  pendingBounds = null
  useTrajectoriesStore.getState().reset()
}
