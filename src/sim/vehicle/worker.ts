/**
 * Vehicle worker — owns vehicle state, runs Störmer-Verlet integration
 * against gravity computed directly from body positions, emits trajectory
 * curves and position updates to the main thread.
 *
 * See notes/05-physics-workers.md for architecture.
 */

import type { TrajectoryCurve, VehicleWorkerInbound, GravitySource } from '../types'
import { toAbsolute } from '../coordinates'
import { integrateVehicle, type VehicleState } from './integrate'

const DT = 1 / 60

let vehicleId = ''
let state: VehicleState | null = null
let gravitySources: GravitySource[] = []
let gravitySrcTime = 0 // simTime when sources were last updated
let warpRate = 1
let simTime = 0

interface PrevState {
  absPos: [number, number, number]
  velocity: [number, number, number]
  simTime: number
}

let prev: PrevState | null = null

function snapshotPrev(): void {
  if (!state) return
  prev = {
    absPos: [...state.position] as [number, number, number],
    velocity: [...state.velocity] as [number, number, number],
    simTime,
  }
}

function emitCurves(): void {
  if (!state || !prev) return

  const curve: TrajectoryCurve = {
    id: vehicleId,
    parentId: '',
    p0: prev.absPos,
    v0: prev.velocity,
    t0: prev.simTime,
    p1: [...state.position] as [number, number, number],
    v1: [...state.velocity] as [number, number, number],
    t1: simTime,
  }

  postMessage({
    type: 'vehicle-trajectories',
    simTime,
    curves: [curve],
  })

  postMessage({
    type: 'vehicle-position',
    position: [...state.position] as [number, number, number],
    velocity: [...state.velocity] as [number, number, number],
  })

  snapshotPrev()
}

/**
 * Compute gravitational acceleration at (x,y,z) from all gravity sources.
 * Body positions are linearly predicted from their last known state.
 */
function gravityAt(x: number, y: number, z: number, out: [number, number, number]): void {
  out[0] = out[1] = out[2] = 0
  const elapsed = simTime - gravitySrcTime
  for (let i = 0; i < gravitySources.length; i++) {
    const src = gravitySources[i]
    // Predict body position at current simTime
    const bx = src.position[0] + src.velocity[0] * elapsed
    const by = src.position[1] + src.velocity[1] * elapsed
    const bz = src.position[2] + src.velocity[2] * elapsed
    const dx = bx - x
    const dy = by - y
    const dz = bz - z
    const r2 = dx * dx + dy * dy + dz * dz
    const r = Math.sqrt(r2)
    if (r < 1) continue
    const f = src.gm / (r2 * r)
    out[0] += f * dx
    out[1] += f * dy
    out[2] += f * dz
  }
}

function tick(): void {
  if (!state || gravitySources.length === 0) return

  // Cap advancement: don't race more than one tick ahead of the latest
  // gravity source update. Without this, the vehicle worker's faster tick
  // (fewer computations) causes simTime to drift ahead of the orbital
  // worker, making body position predictions extrapolate too far.
  const ceiling = gravitySrcTime + warpRate * DT
  const maxSteps = Math.min(warpRate, Math.max(0, Math.floor((ceiling - simTime) / DT)))

  for (let i = 0; i < maxSteps; i++) {
    integrateVehicle(state, gravityAt, DT)
    simTime += DT
  }

  if (maxSteps > 0) emitCurves()

  // Self-schedule instead of setInterval to prevent queuing when ticks are slow
  setTimeout(tick, 1000 / 60)
}

onmessage = (e: MessageEvent<VehicleWorkerInbound>) => {
  const msg = e.data

  if (msg.type === 'init') {
    vehicleId = msg.vehicle.id
    const absPos = toAbsolute(msg.vehicle.position)
    state = {
      position: absPos,
      velocity: [...msg.vehicle.velocity] as [number, number, number],
    }
    gravitySources = msg.gravitySources
    gravitySrcTime = 0
    warpRate = msg.warpRate
    simTime = 0

    snapshotPrev()
    setTimeout(tick, 1000 / 60)
  }

  if (msg.type === 'gravity-sources') {
    gravitySources = msg.bodies
    gravitySrcTime = msg.simTime
  }

  if (msg.type === 'set-warp') {
    warpRate = msg.rate
  }
}
