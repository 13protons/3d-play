/**
 * Vehicle worker — owns vehicle state, runs adaptive integration
 * against gravity interpolated from body trajectory curves.
 *
 * Driven by the bridge via 'advance' messages. No self-scheduling.
 */

import type { TrajectoryCurve, VehicleWorkerInbound } from '../types'
import { toAbsolute } from '../coordinates'
import { advanceTo } from '../integrator/adaptive'
import { pointMassDerivatives } from '../integrator/derivatives'

let vehicleId = ''
let stateVec: Float64Array | null = null
let bodyGMs = new Map<string, number>()
let simTime = 0

function emitCurves(prevTime: number, prevState: Float64Array): void {
  if (!stateVec) return

  const curve: TrajectoryCurve = {
    id: vehicleId,
    parentId: '',
    p0: [prevState[0], prevState[1], prevState[2]],
    v0: [prevState[3], prevState[4], prevState[5]],
    t0: prevTime,
    p1: [stateVec[0], stateVec[1], stateVec[2]],
    v1: [stateVec[3], stateVec[4], stateVec[5]],
    t1: simTime,
  }

  postMessage({
    type: 'vehicle-trajectories',
    simTime,
    curves: [curve],
  })
}

onmessage = (e: MessageEvent<VehicleWorkerInbound>) => {
  const msg = e.data

  if (msg.type === 'init') {
    vehicleId = msg.vehicle.id
    const absPos = toAbsolute(msg.vehicle.position)
    stateVec = new Float64Array([
      absPos[0], absPos[1], absPos[2],
      msg.vehicle.velocity[0], msg.vehicle.velocity[1], msg.vehicle.velocity[2],
    ])
    bodyGMs = new Map(msg.bodyGMs)
    simTime = 0

    // Build derivative from initial body curves and integrate to initial time
    const initState = new Float64Array(stateVec)
    emitCurves(0, initState)
  }

  if (msg.type === 'advance') {
    if (!stateVec) return
    const targetTime = msg.targetTime
    if (targetTime <= simTime) {
      emitCurves(simTime, new Float64Array(stateVec))
      return
    }

    const prevTime = simTime
    const prevState = new Float64Array(stateVec)

    // Build gravity function from body trajectory curves for this batch
    const deriv = pointMassDerivatives(msg.bodyCurves, bodyGMs)

    advanceTo(stateVec, simTime, targetTime, deriv, 1e-10)
    simTime = targetTime

    emitCurves(prevTime, prevState)
  }
}
