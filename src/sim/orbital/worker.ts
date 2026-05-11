/**
 * Orbital worker — owns celestial body state, runs adaptive n-body
 * integration, emits trajectory curves to the main thread.
 *
 * Driven by the bridge via 'advance' messages. No self-scheduling.
 */

import type { TrajectoryCurve, SectorPosition } from '../types'
import { toAbsolute } from '../coordinates'
import { advanceTo } from '../integrator/adaptive'
import { nBodyDerivativesFromGMs } from '../integrator/derivatives'

interface InitBody {
  id: string
  name: string
  parentId: string | null
  mass: number
  gm: number
  radius: number
  soiRadius?: number
  position: SectorPosition
  velocity: [number, number, number]
}

let bodyIds: string[] = []
let gms: number[] = []
let stateVec: Float64Array | null = null
let simTime = 0
let deriv: ReturnType<typeof nBodyDerivativesFromGMs> | null = null

/** Unpack state vector back to absolute positions + velocities per body. */
function emitCurves(prevTime: number, prevState: Float64Array): void {
  if (!stateVec) return
  const curves: TrajectoryCurve[] = []
  for (let i = 0; i < bodyIds.length; i++) {
    const b = i * 6
    curves.push({
      id: bodyIds[i],
      parentId: '',
      p0: [prevState[b], prevState[b + 1], prevState[b + 2]],
      v0: [prevState[b + 3], prevState[b + 4], prevState[b + 5]],
      t0: prevTime,
      p1: [stateVec[b], stateVec[b + 1], stateVec[b + 2]],
      v1: [stateVec[b + 3], stateVec[b + 4], stateVec[b + 5]],
      t1: simTime,
    })
  }
  postMessage({ type: 'trajectories', simTime, curves })
}

onmessage = (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'init') {
    const bodies = msg.bodies as InitBody[]
    bodyIds = bodies.map((b) => b.id)
    gms = bodies.map((b) => b.gm)
    deriv = nBodyDerivativesFromGMs(gms)

    // Pack initial state vector: [x0,y0,z0,vx0,vy0,vz0, x1,...]
    stateVec = new Float64Array(bodies.length * 6)
    for (let i = 0; i < bodies.length; i++) {
      const abs = toAbsolute(bodies[i].position)
      const b = i * 6
      stateVec[b] = abs[0]; stateVec[b + 1] = abs[1]; stateVec[b + 2] = abs[2]
      stateVec[b + 3] = bodies[i].velocity[0]
      stateVec[b + 4] = bodies[i].velocity[1]
      stateVec[b + 5] = bodies[i].velocity[2]
    }
    simTime = 0

    // Emit initial curves (zero-length, establishes starting positions)
    const initState = new Float64Array(stateVec)
    emitCurves(0, initState)
  }

  if (msg.type === 'advance') {
    if (!stateVec || !deriv) return
    const targetTime = msg.targetTime as number
    if (targetTime <= simTime) {
      // Already there — emit current state
      emitCurves(simTime, new Float64Array(stateVec))
      return
    }

    const prevTime = simTime
    const prevState = new Float64Array(stateVec)

    advanceTo(stateVec, simTime, targetTime, deriv, 1e-10)
    simTime = targetTime

    emitCurves(prevTime, prevState)
  }
}
