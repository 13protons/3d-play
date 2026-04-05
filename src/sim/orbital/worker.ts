/**
 * Orbital worker — owns celestial body state, runs n-body integration,
 * emits trajectory curves to the main thread.
 *
 * For v1: all curves are absolute (not parent-relative). This simplifies
 * the renderer at the cost of curve accuracy for moons. The architecture
 * supports parent-relative curves when we're ready (see notes/05).
 */

import type { CelestialBody, TrajectoryCurve, SectorPosition } from '../types'
import { toAbsolute } from '../coordinates'
import { integrate } from './integrator'

interface InitBody {
  id: string
  name: string
  parentId: string | null
  mass: number
  radius: number
  soiRadius?: number
  position: SectorPosition
  velocity: [number, number, number]
}

interface PrevState {
  absPos: [number, number, number]
  velocity: [number, number, number]
  simTime: number
}

const DT = 1 / 60

let bodies: CelestialBody[] = []
let simTime = 0
let warpRate = 1
const prevStates = new Map<string, PrevState>()

function snapshotPrev(): void {
  for (const body of bodies) {
    prevStates.set(body.id, {
      absPos: toAbsolute(body.position),
      velocity: [...body.velocity] as [number, number, number],
      simTime,
    })
  }
}

function emitCurves(): void {
  const curves: TrajectoryCurve[] = []

  for (const body of bodies) {
    const prev = prevStates.get(body.id)
    if (!prev) continue

    curves.push({
      id: body.id,
      parentId: '',
      p0: prev.absPos,
      v0: prev.velocity,
      t0: prev.simTime,
      p1: toAbsolute(body.position),
      v1: [...body.velocity] as [number, number, number],
      t1: simTime,
    })
  }

  postMessage({ type: 'trajectories', simTime, curves })
  snapshotPrev()
}

function tick(): void {
  for (let i = 0; i < warpRate; i++) {
    integrate(bodies, DT)
    simTime += DT
  }
  emitCurves()

  // Self-schedule instead of setInterval to prevent queuing when ticks are slow
  setTimeout(tick, 1000 / 60)
}

onmessage = (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'init') {
    bodies = (msg.bodies as InitBody[]).map((b) => ({
      id: b.id,
      name: b.name,
      parentId: b.parentId,
      mass: b.mass,
      radius: b.radius,
      soiRadius: b.soiRadius,
      position: b.position,
      velocity: b.velocity,
      orientation: [0, 0, 0, 1] as [number, number, number, number],
      angularVelocity: 0,
    }))

    simTime = 0
    snapshotPrev()
    setTimeout(tick, 1000 / 60)
  }

  if (msg.type === 'set-warp') {
    warpRate = msg.rate
  }
}
