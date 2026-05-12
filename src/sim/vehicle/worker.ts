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
import {
  integrateOrientation,
  shouldDisableThrottleForWarp,
  shouldStabilizeAngularVelocityForWarp,
  thrustAccelerationForElapsedRotation,
  type Quaternion,
  type Vec3,
} from './controls'

let vehicleId = ''
let stateVec: Float64Array | null = null
let bodyGMs = new Map<string, number>()
let simTime = 0
let throttle = 0
let orientation: Quaternion = [0, 0, 0, 1]
let angularVelocity: Vec3 = [0, 0, 0]

function emitControls(): void {
  postMessage({
    type: 'vehicle-controls',
    id: vehicleId,
    throttle,
    orientation,
    angularVelocity,
  })
}

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
    throttle = 0
    orientation = [0, 0, 0, 1]
    angularVelocity = [0, 0, 0]

    // Build derivative from initial body curves and integrate to initial time
    const initState = new Float64Array(stateVec)
    emitCurves(0, initState)
    emitControls()
  }

  if (msg.type === 'set-throttle') {
    throttle = Math.max(0, Math.min(1, msg.value))
    emitControls()
  }

  if (msg.type === 'set-attitude') {
    angularVelocity = [msg.pitch, msg.yaw, msg.roll]
    emitControls()
  }

  if (msg.type === 'set-warp') {
    let changedControls = false
    if (shouldStabilizeAngularVelocityForWarp(msg.rate)) {
      angularVelocity = [0, 0, 0]
      changedControls = true
    }
    if (shouldDisableThrottleForWarp(msg.rate)) {
      throttle = 0
      changedControls = true
    }
    if (changedControls) emitControls()
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

    const gravityDeriv = pointMassDerivatives(msg.bodyCurves, bodyGMs)
    const deriv = (t: number, y: Float64Array, dydt: Float64Array): void => {
      gravityDeriv(t, y, dydt)
      const thrust = thrustAccelerationForElapsedRotation(
        orientation,
        angularVelocity,
        t - simTime,
        throttle,
      )
      dydt[3] += thrust[0]
      dydt[4] += thrust[1]
      dydt[5] += thrust[2]
    }

    advanceTo(stateVec, simTime, targetTime, deriv, 1e-10)
    orientation = integrateOrientation(orientation, angularVelocity, targetTime - simTime)
    simTime = targetTime

    emitCurves(prevTime, prevState)
    emitControls()
  }
}
