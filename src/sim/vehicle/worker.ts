/**
 * Vehicle worker — owns vehicle state, runs Störmer-Verlet integration
 * against a cube patch gravity field, emits trajectory curves and position
 * updates to the main thread.
 *
 * See notes/05-physics-workers.md for architecture.
 */

import type { TrajectoryCurve, VehicleWorkerInbound } from '../types'
import { toAbsolute } from '../coordinates'
import { integrateVehicle, type VehicleState } from './integrate'

const DT = 1 / 60

let vehicleId = ''
let state: VehicleState | null = null
let cubePatch: Float64Array | null = null
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

function tick(): void {
  if (!state || !cubePatch) return

  for (let i = 0; i < warpRate; i++) {
    integrateVehicle(state, cubePatch, DT)
    simTime += DT
  }

  emitCurves()

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
    cubePatch = msg.cubePatch
    warpRate = msg.warpRate
    simTime = 0

    snapshotPrev()
    setTimeout(tick, 1000 / 60)
  }

  if (msg.type === 'cube-patch') {
    cubePatch = msg.data
  }

  if (msg.type === 'set-warp') {
    warpRate = msg.rate
  }
}
