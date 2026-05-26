/**
 * Vehicle worker — owns vehicle state, runs adaptive integration
 * against gravity interpolated from body trajectory curves.
 *
 * Driven by the bridge via 'advance' messages. No self-scheduling.
 */

import type { AttitudeTarget, TrajectoryCurve, VehicleWorkerInbound } from '../types'
import { toAbsolute } from '../coordinates'
import { advanceTo } from '../integrator/adaptive'
import { pointMassDerivatives } from '../integrator/derivatives'
import {
  angularVelocityAfterTorque,
  angularVelocityDampingTorque,
  forwardDirectionHoldTorque,
  integrateOrientation,
  manualReactionWheelTorque,
  rotateOrientationAroundWorldAxis,
  shouldDisableThrottleForWarp,
  shouldEmitAeroForce,
  shouldStabilizeAngularVelocityForWarp,
  sumAndClampTorque,
  thrustAccelerationForElapsedRotation,
  type Quaternion,
  type Vec3,
} from './controls'
import { vehicleDerivatives, type VehicleAero, type VehicleEngine, type VehicleResources } from './dynamics'
import type { VehicleAttitude } from '../types'
import {
  classifySurfaceContact,
  classifySurfaceContactAlongSegment,
  rotatingSurfaceState,
  type SurfaceContact,
} from './surfaceContact'

let vehicleId = ''
let parentId = ''
let stateVec: Float64Array | null = null
let bodyGMs = new Map<string, number>()
type BodySurface = {
  radius: number
  angularVelocity: number
  rotationAxis: Vec3
  atmosphere?: {
    loadRadiusMultiplier: number
    model: 'exponential'
    surfaceDensity: number
    scaleHeight: number
    maxAltitude: number
  }
}

let bodySurfaces = new Map<string, BodySurface>()
let resources: VehicleResources | undefined
let engine: VehicleEngine | undefined
let attitude: VehicleAttitude | undefined
let aero: VehicleAero | undefined
let simTime = 0
let throttle = 0
let orientation: Quaternion = [0, 0, 0, 1]
let angularVelocity: Vec3 = [0, 0, 0]
let manualTorque: Vec3 = [0, 0, 0]
let attitudeTarget: AttitudeTarget = { kind: 'manual' }
let surfaceContact: SurfaceContact = { type: 'flying' }
let landedAt = 0
let aeroForceWorld: Vec3 = [0, 0, 0]

const LANDING_SPEED_THRESHOLD = 10

function emitControls(): void {
  postMessage({
    type: 'vehicle-controls',
    id: vehicleId,
    throttle,
    orientation,
    angularVelocity,
    attitudeTargetKind: attitudeTarget.kind,
    surfaceState: surfaceContact.type,
    reactionWheelTorque: attitude?.reactionWheelTorque,
    mass: resources?.mass,
    maxThrust: engine?.maxThrust,
    currentThrust: engine ? engine.maxThrust * throttle : undefined,
    aeroForceWorld: shouldEmitAeroForce(aeroForceWorld) ? aeroForceWorld : undefined,
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
    parentId = msg.vehicle.parentId
    const absPos = toAbsolute(msg.vehicle.position)
    stateVec = new Float64Array([
      absPos[0], absPos[1], absPos[2],
      msg.vehicle.velocity[0], msg.vehicle.velocity[1], msg.vehicle.velocity[2],
    ])
    bodyGMs = new Map(msg.bodyGMs)
    bodySurfaces = new Map(msg.bodySurfaces.map(([id, radius, angularVelocity, axialTilt, atmosphere]) => [
      id,
      { radius, angularVelocity, rotationAxis: rotationAxisFromAxialTilt(axialTilt), atmosphere },
    ]))
    resources = msg.resources
    engine = msg.engine
    attitude = msg.attitude
    aero = msg.aero
    simTime = 0
    throttle = 0
    orientation = [0, 0, 0, 1]
    angularVelocity = [0, 0, 0]
    manualTorque = [0, 0, 0]
    attitudeTarget = { kind: 'manual' }
    surfaceContact = { type: 'flying' }
    landedAt = 0
    aeroForceWorld = [0, 0, 0]

    const parentCurve = msg.bodyCurves.find((curve) => curve.id === parentId)
    const parentSurface = bodySurfaces.get(parentId)
    if (parentCurve && parentSurface) {
      const parentPosition = sampleCurvePosition(parentCurve, simTime)
      const parentVelocity = sampleCurveVelocity(parentCurve, simTime)
      const relativePosition: Vec3 = [
        stateVec[0] - parentPosition[0],
        stateVec[1] - parentPosition[1],
        stateVec[2] - parentPosition[2],
      ]
      const relativeVelocity: Vec3 = [
        stateVec[3] - parentVelocity[0],
        stateVec[4] - parentVelocity[1],
        stateVec[5] - parentVelocity[2],
      ]
      surfaceContact = classifySurfaceContact({
        relativePosition,
        relativeVelocity,
        parentRadius: parentSurface.radius,
        landingSpeedThreshold: LANDING_SPEED_THRESHOLD,
      })
      if (surfaceContact.type !== 'flying') {
        const landed = rotatingSurfaceState({
          landedAt,
          simTime,
          initialSurfaceNormal: surfaceContact.surfaceNormal,
          parentPosition,
          parentVelocity,
          parentRadius: parentSurface.radius,
          parentAngularVelocity: parentSurface.angularVelocity,
          parentRotationAxis: parentSurface.rotationAxis,
        })
        stateVec.set([...landed.position, ...landed.velocity])
      }
    }

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
    manualTorque = [msg.pitch, msg.yaw, msg.roll]
    emitControls()
  }

  if (msg.type === 'set-attitude-target') {
    // High-frequency from the autopilot — don't re-emit controls here.
    // The next `advance` will broadcast updated state.
    attitudeTarget = msg.target
  }

  if (msg.type === 'set-warp') {
    let changedControls = false
    if (shouldStabilizeAngularVelocityForWarp(msg.rate)) {
      angularVelocity = [0, 0, 0]
      manualTorque = [0, 0, 0]
      attitudeTarget = { kind: 'manual' }
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
    const elapsedSeconds = targetTime - simTime
    aeroForceWorld = [0, 0, 0]

    const parentCurve = msg.bodyCurves.find((curve) => curve.id === parentId)
    const parentSurface = bodySurfaces.get(parentId)

    if (surfaceContact.type !== 'flying' && parentCurve && parentSurface) {
      const parentPosition = sampleCurvePosition(parentCurve, targetTime)
      const parentVelocity = sampleCurveVelocity(parentCurve, targetTime)
      const landed = rotatingSurfaceState({
        landedAt,
        simTime: targetTime,
        initialSurfaceNormal: surfaceContact.surfaceNormal,
        parentPosition,
        parentVelocity,
        parentRadius: parentSurface.radius,
        parentAngularVelocity: parentSurface.angularVelocity,
        parentRotationAxis: parentSurface.rotationAxis,
      })
      const currentNormal = normalize([
        landed.position[0] - parentPosition[0],
        landed.position[1] - parentPosition[1],
        landed.position[2] - parentPosition[2],
      ])
      const thrust = thrustAccelerationForElapsedRotation(
        orientation,
        angularVelocity,
        0,
        throttle,
        resources && engine ? { maxThrust: engine.maxThrust, mass: resources.mass } : undefined,
      )
      if (surfaceContact.type === 'landed' && dot(thrust, currentNormal) > 0) {
        surfaceContact = { type: 'flying' }
      } else {
        stateVec.set([...landed.position, ...landed.velocity])
        updateAngularState(elapsedSeconds, currentAttitudeTorque())
        // Co-rotate with the parent so a landed vehicle's orientation tracks
        // the surface it's glued to instead of drifting in inertial space.
        orientation = rotateOrientationAroundWorldAxis(
          orientation,
          parentSurface.rotationAxis,
          parentSurface.angularVelocity * elapsedSeconds,
        )
        simTime = targetTime
        emitCurves(prevTime, prevState)
        emitControls()
        return
      }
    }

    const deriv = vehicleDerivatives({
      gravity: pointMassDerivatives(msg.bodyCurves, bodyGMs),
      parentId,
      bodyCurves: msg.bodyCurves,
      bodySurfaces,
      resources,
      engine,
      aero,
      orientation,
      angularVelocity,
      throttle,
      simTime,
      onAeroForce: (force) => {
        aeroForceWorld = force
      },
    })

    advanceTo(stateVec, simTime, targetTime, deriv, 1e-10)
    updateAngularState(elapsedSeconds, currentAttitudeTorque())
    simTime = targetTime

    if (surfaceContact.type === 'flying' && parentCurve && parentSurface) {
      const parentPosition = sampleCurvePosition(parentCurve, simTime)
      const parentVelocity = sampleCurveVelocity(parentCurve, simTime)
      const previousParentPosition = sampleCurvePosition(parentCurve, prevTime)
      const relativePosition: Vec3 = [
        stateVec[0] - parentPosition[0],
        stateVec[1] - parentPosition[1],
        stateVec[2] - parentPosition[2],
      ]
      const relativeVelocity: Vec3 = [
        stateVec[3] - parentVelocity[0],
        stateVec[4] - parentVelocity[1],
        stateVec[5] - parentVelocity[2],
      ]
      const previousRelativePosition: Vec3 = [
        prevState[0] - previousParentPosition[0],
        prevState[1] - previousParentPosition[1],
        prevState[2] - previousParentPosition[2],
      ]
      const contact = classifySurfaceContactAlongSegment({
        previousRelativePosition,
        currentRelativePosition: relativePosition,
        relativeVelocity,
        elapsedSeconds: simTime - prevTime,
        parentRadius: parentSurface.radius,
        landingSpeedThreshold: LANDING_SPEED_THRESHOLD,
      })
      if (contact.type !== 'flying') {
        surfaceContact = contact
        landedAt = prevTime + (contact.segmentT ?? 1) * (simTime - prevTime)
        const landed = rotatingSurfaceState({
          landedAt,
          simTime,
          initialSurfaceNormal: contact.surfaceNormal,
          parentPosition,
          parentVelocity,
          parentRadius: parentSurface.radius,
          parentAngularVelocity: parentSurface.angularVelocity,
          parentRotationAxis: parentSurface.rotationAxis,
        })
        stateVec.set([...landed.position, ...landed.velocity])
        if (contact.type === 'crashed') {
          angularVelocity = [0, 0, 0]
          manualTorque = [0, 0, 0]
        }
      }
    }

    emitCurves(prevTime, prevState)
    emitControls()
  }
}

function updateAngularState(elapsedSeconds: number, torque: Vec3): void {
  if (elapsedSeconds <= 0) return
  angularVelocity = attitude
    ? angularVelocityAfterTorque(
        angularVelocity,
        torque,
        attitude.momentOfInertia,
        elapsedSeconds,
      )
    : torque
  orientation = integrateOrientation(orientation, angularVelocity, elapsedSeconds)
}

function currentAttitudeTorque(): Vec3 {
  if (!attitude) return manualTorque
  if (attitudeTarget.kind === 'manual') {
    return manualReactionWheelTorque({
      commandTorque: manualTorque,
      angularVelocity,
    })
  }
  if (attitudeTarget.kind === 'damp') {
    const dampingTorque = angularVelocityDampingTorque({
      angularVelocity,
      maxTorque: attitude.reactionWheelTorque,
      momentOfInertia: attitude.momentOfInertia,
    })
    return sumAndClampTorque(dampingTorque, manualTorque, attitude.reactionWheelTorque)
  }
  const holdTorque = forwardDirectionHoldTorque({
    currentOrientation: orientation,
    targetForward: attitudeTarget.vector,
    angularVelocity,
    maxTorque: attitude.reactionWheelTorque,
    momentOfInertia: attitude.momentOfInertia,
  })
  return sumAndClampTorque(holdTorque, manualTorque, attitude.reactionWheelTorque)
}

function sampleCurvePosition(curve: TrajectoryCurve, t: number): Vec3 {
  const dt = curve.t1 - curve.t0
  if (dt === 0) return curve.p1
  const s = (t - curve.t0) / dt
  const s2 = s * s
  const s3 = s2 * s
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2
  return [
    h00 * curve.p0[0] + h10 * dt * curve.v0[0] + h01 * curve.p1[0] + h11 * dt * curve.v1[0],
    h00 * curve.p0[1] + h10 * dt * curve.v0[1] + h01 * curve.p1[1] + h11 * dt * curve.v1[1],
    h00 * curve.p0[2] + h10 * dt * curve.v0[2] + h01 * curve.p1[2] + h11 * dt * curve.v1[2],
  ]
}

function sampleCurveVelocity(curve: TrajectoryCurve, t: number): Vec3 {
  const dt = curve.t1 - curve.t0
  if (dt === 0) return curve.v1
  const s = (t - curve.t0) / dt
  const s2 = s * s
  const dh00 = 6 * s2 - 6 * s
  const dh10 = 3 * s2 - 4 * s + 1
  const dh01 = -6 * s2 + 6 * s
  const dh11 = 3 * s2 - 2 * s
  return [
    (dh00 * curve.p0[0] + dh10 * dt * curve.v0[0] + dh01 * curve.p1[0] + dh11 * dt * curve.v1[0]) / dt,
    (dh00 * curve.p0[1] + dh10 * dt * curve.v0[1] + dh01 * curve.p1[1] + dh11 * dt * curve.v1[1]) / dt,
    (dh00 * curve.p0[2] + dh10 * dt * curve.v0[2] + dh01 * curve.p1[2] + dh11 * dt * curve.v1[2]) / dt,
  ]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function normalize(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2])
  return m > 0 ? [v[0] / m, v[1] / m, v[2] / m] : [1, 0, 0]
}

function rotationAxisFromAxialTilt(axialTiltDegrees: number): Vec3 {
  const tilt = (axialTiltDegrees * Math.PI) / 180
  return normalize([-Math.sin(tilt), Math.cos(tilt), 0])
}
