/**
 * Vehicle worker — owns vehicle state, runs adaptive integration
 * against gravity interpolated from body trajectory curves.
 *
 * Driven by the bridge via 'advance' messages. No self-scheduling.
 */

import type { AttitudeTarget, TrajectoryCurve, VehicleWorkerInbound } from '../types'
import { toAbsolute } from '../coordinates'
import { evaluateCurve, evaluateCurveVelocity } from '../curves'
import { advanceTo } from '../integrator/adaptive'
import { pointMassDerivatives } from '../integrator/derivatives'
import {
  MAX_MANUAL_ANGULAR_RATE,
  advanceManualHoldTime,
  angularRateSeekTorque,
  angularVelocityDampingTorque,
  forwardDirectionHoldTorque,
  integrateAttitudeOverStep,
  integrateOrientation,
  manualTorqueRampScale,
  quaternionFromBasis,
  rotateOrientationAroundWorldAxis,
  shouldDisableThrottleForWarp,
  shouldEmitAeroForce,
  shouldStabilizeAngularVelocityForWarp,
  thrustAccelerationForElapsedRotation,
  thrustAccelerationFromBodyForce,
  type Quaternion,
  type Vec3,
} from './controls'
import { vehicleDerivatives, type VehicleAero, type VehicleEngine, type VehicleResources } from './dynamics'
import { exponentialAtmosphereDensity } from './aero'
import { fuelBurned, fuelLimitedThrottle } from './thrust'
import { surfaceFrame } from './referenceFrame'
import { VehicleStructure } from './structure'
import type { Mat3 } from './mat3'
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
/**
 * The structural model when the craft has propulsion. Source of truth for mass,
 * CoM, inertia, fuel, and net thrust. For legacy single-body scenarios it's the
 * synthesized 1-part structure (numerically identical to the old model); for an
 * authored tree it carries the real geometry. Null only for unpowered craft.
 */
let structure: VehicleStructure | null = null
/** Per-step thrust + inertia derived from the structure, shared with attitude. */
let thrustForceBody: Vec3 = [0, 0, 0]
let thrustTorqueBody: Vec3 = [0, 0, 0]
let inertiaTensorStep: Mat3 | undefined
let inertiaInverseStep: Mat3 | null | undefined
/** Ambient pressure ratio (0 = vacuum, 1 = sea level) from the last advance. */
let lastPressureRatio = 0
let simTime = 0
let warpRate = 1
let throttle = 0
let orientation: Quaternion = [0, 0, 0, 1]
let angularVelocity: Vec3 = [0, 0, 0]
let manualTorque: Vec3 = [0, 0, 0]
/** Per-axis continuous hold time for manual input, driving the torque ramp. */
let manualHoldTime: Vec3 = [0, 0, 0]
/** Last reaction-wheel torque actually commanded — published for diagnostics. */
let commandedTorque: Vec3 = [0, 0, 0]
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
    commandedTorque,
    mass: resources?.mass,
    fuelMass: resources?.fuelMass,
    maxThrust: structure ? structure.totalMaxThrust(lastPressureRatio) : engine?.maxThrust,
    isp: structure ? structure.isp(lastPressureRatio) : engine?.isp,
    currentThrust: structure
      ? structure.stageFuel() > 0
        ? structure.totalMaxThrust(lastPressureRatio) * throttle
        : 0
      : undefined,
    aeroForceWorld: shouldEmitAeroForce(aeroForceWorld) ? aeroForceWorld : undefined,
    currentStage: structure?.currentStage,
    canStage: structure?.canStage(),
    stages: structure?.stageSummaries(),
    // Body-frame CoM so the renderer can pivot the craft about it (it shifts as
    // fuel burns and jumps on staging). The tracked trajectory point is the CoM.
    centerOfMass: structure ? structure.aggregate().centerOfMass : undefined,
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

    // Build the structural model. An authored part tree wins; otherwise, a
    // powered craft gets a degenerate 1-part structure that reproduces the
    // single-body numbers exactly. Unpowered craft (no engine) have none.
    if (msg.parts && msg.parts.length > 0 && msg.partDefs) {
      structure = new VehicleStructure(msg.parts, new Map(msg.partDefs))
    } else if (resources && engine) {
      structure = VehicleStructure.singleBody({
        dryMass: resources.dryMass,
        fuelMass: resources.fuelMass,
        maxThrust: engine.maxThrust,
        isp: engine.isp,
        reactionWheelTorque: attitude?.reactionWheelTorque,
      })
    } else {
      structure = null
    }
    // A multi-part craft without an authored attitude derives its controller
    // limits from geometry (diagonal of the inertia tensor + summed wheels).
    if (structure && !attitude) {
      const agg = structure.aggregate()
      if (agg.inertiaInverse) {
        attitude = {
          momentOfInertia: [agg.inertia[0], agg.inertia[4], agg.inertia[8]],
          reactionWheelTorque: structure.reactionWheelTorque,
        }
      }
    }
    thrustForceBody = [0, 0, 0]
    thrustTorqueBody = [0, 0, 0]
    inertiaTensorStep = undefined
    inertiaInverseStep = undefined
    lastPressureRatio = 0

    simTime = 0
    warpRate = 1
    throttle = 0
    orientation = [0, 0, 0, 1]
    angularVelocity = [0, 0, 0]
    manualTorque = [0, 0, 0]
    manualHoldTime = [0, 0, 0]
    attitudeTarget = { kind: 'manual' }
    surfaceContact = { type: 'flying' }
    landedAt = 0
    aeroForceWorld = [0, 0, 0]

    const parentCurve = msg.bodyCurves.find((curve) => curve.id === parentId)
    const parentSurface = bodySurfaces.get(parentId)
    if (parentCurve && parentSurface) {
      const parentPosition = evaluateCurve(parentCurve, simTime)
      const parentVelocity = evaluateCurveVelocity(parentCurve, simTime)
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
      // Stand the vehicle up: forward (+Z) radial-out, pitch (+X) along East,
      // yaw (+Y) along North — so the controls map to compass directions.
      const launchFrame = surfaceFrame(relativePosition, parentSurface.rotationAxis)
      if (launchFrame) {
        orientation = quaternionFromBasis(launchFrame.east, launchFrame.north, launchFrame.up)
      }
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

  if (msg.type === 'stage') {
    if (structure) {
      const jettisoned = structure.stage()
      if (jettisoned.length > 0) {
        // Structural-sync: tell the outside render mirror what was dropped.
        postMessage({ type: 'vehicle-structure', id: vehicleId, jettisoned, currentStage: structure.currentStage })
        // Mass/fuel readouts change immediately on a clean step boundary.
        if (resources) {
          const agg = structure.aggregate()
          resources = { dryMass: resources.dryMass, fuelMass: structure.totalFuel(), mass: agg.mass }
        }
        emitControls()
      }
    }
  }

  if (msg.type === 'set-warp') {
    warpRate = msg.rate
    let changedControls = false
    if (shouldStabilizeAngularVelocityForWarp(msg.rate)) {
      angularVelocity = [0, 0, 0]
      manualTorque = [0, 0, 0]
      manualHoldTime = [0, 0, 0]
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
    manualHoldTime = advanceManualHoldTime(manualHoldTime, manualTorque, elapsedSeconds)
    aeroForceWorld = [0, 0, 0]

    // Aggregate the structure for this step: mass / CoM / inertia all follow the
    // current fuel. Propellant limits thrust — full throttle while fuel lasts,
    // scaled down on the step that empties the tank, zero when dry. Net thrust
    // (force + torque about the CoM) and the inertia tensor are stashed for the
    // derivative and the attitude integrator below.
    const parentCurve = msg.bodyCurves.find((curve) => curve.id === parentId)
    const parentSurface = bodySurfaces.get(parentId)

    // Ambient pressure ratio (0 = vacuum, 1 = sea level) for atmospheric engine
    // performance. For an isothermal exponential atmosphere pressure tracks
    // density, so the ratio is just density / surface density at this altitude.
    let pressureRatio = 0
    if (parentCurve && parentSurface?.atmosphere) {
      const parentPosition = evaluateCurve(parentCurve, simTime)
      const altitude = Math.hypot(
        stateVec[0] - parentPosition[0],
        stateVec[1] - parentPosition[1],
        stateVec[2] - parentPosition[2],
      ) - parentSurface.radius
      const density = exponentialAtmosphereDensity(parentSurface.atmosphere, altitude)
      pressureRatio = Math.min(1, Math.max(0, density / parentSurface.atmosphere.surfaceDensity))
    }
    lastPressureRatio = pressureRatio

    let effectiveThrottle = throttle
    thrustForceBody = [0, 0, 0]
    thrustTorqueBody = [0, 0, 0]
    inertiaTensorStep = undefined
    inertiaInverseStep = undefined
    if (structure) {
      const agg = structure.aggregate()
      if (resources) resources = { dryMass: resources.dryMass, fuelMass: structure.totalFuel(), mass: agg.mass }
      effectiveThrottle = fuelLimitedThrottle({
        maxThrust: structure.totalMaxThrust(pressureRatio),
        isp: structure.isp(pressureRatio),
        throttle,
        fuelMass: structure.stageFuel(),
        elapsedSeconds,
      })
      // Use the geometric tensor only when it inverts (a real multi-part craft).
      // The synthesized single-body case stays on the authored diagonal MoI.
      if (agg.inertiaInverse) {
        inertiaTensorStep = agg.inertia
        inertiaInverseStep = agg.inertiaInverse
        if (attitude) attitude.momentOfInertia = [agg.inertia[0], agg.inertia[4], agg.inertia[8]]
      }

      // Gimbaled thrust: point the engines toward the controller's desired
      // steering torque; the deflected thrust imparts a torque from each engine's
      // mount point, and the integrator + reaction wheels take it from there. The
      // deflection range is the only limit; a centered engine has no moment arm,
      // so the solve yields no deflection and the craft just steers with wheels.
      const desired = attitude
        ? desiredControlTorque(orientation, angularVelocity, [Infinity, Infinity, Infinity])
        : ([0, 0, 0] as Vec3)
      const { gx, gy } = structure.solveGimbal(agg.centerOfMass, effectiveThrottle, desired[0], desired[1], pressureRatio)
      const thrust = structure.netThrustBodyGimbaled(effectiveThrottle, agg.centerOfMass, gx, gy, pressureRatio)
      thrustForceBody = thrust.force
      thrustTorqueBody = thrust.torque
    }

    if (surfaceContact.type !== 'flying' && parentCurve && parentSurface) {
      const parentPosition = evaluateCurve(parentCurve, targetTime)
      const parentVelocity = evaluateCurveVelocity(parentCurve, targetTime)
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
      const thrust = structure
        ? thrustAccelerationFromBodyForce(thrustForceBody, structure.aggregate().mass, orientation, angularVelocity, 0)
        : thrustAccelerationForElapsedRotation(
            orientation,
            angularVelocity,
            0,
            effectiveThrottle,
            resources && engine ? { maxThrust: engine.maxThrust, mass: resources.mass } : undefined,
          )
      if (surfaceContact.type === 'landed' && dot(thrust, currentNormal) > 0) {
        surfaceContact = { type: 'flying' }
      } else {
        stateVec.set([...landed.position, ...landed.velocity])
        advanceAttitude(elapsedSeconds, thrustTorqueBody, inertiaTensorStep, inertiaInverseStep)
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
      throttle: effectiveThrottle,
      simTime,
      onAeroForce: (force) => {
        aeroForceWorld = force
      },
      // Spine path: net thrust force + current mass from the structure.
      thrustBodyForce: structure ? thrustForceBody : undefined,
      thrustMass: structure ? resources?.mass : undefined,
    })

    advanceTo(stateVec, simTime, targetTime, deriv, 1e-10)
    advanceAttitude(elapsedSeconds, thrustTorqueBody, inertiaTensorStep, inertiaInverseStep)
    // Burn the propellant this step consumed and drop the vehicle's mass to
    // match (the rocket equation in action).
    if (structure && effectiveThrottle > 0) {
      const burned = fuelBurned({
        maxThrust: structure.totalMaxThrust(lastPressureRatio),
        isp: structure.isp(lastPressureRatio),
        throttle: effectiveThrottle,
        fuelMass: structure.stageFuel(),
        elapsedSeconds,
      })
      if (burned > 0) {
        structure.drain(burned)
        if (resources) resources = { ...resources, fuelMass: structure.totalFuel(), mass: structure.aggregate().mass }
      }
    }
    simTime = targetTime

    if (surfaceContact.type === 'flying' && parentCurve && parentSurface) {
      const parentPosition = evaluateCurve(parentCurve, simTime)
      const parentVelocity = evaluateCurveVelocity(parentCurve, simTime)
      const previousParentPosition = evaluateCurve(parentCurve, prevTime)
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

/**
 * Advance vehicle attitude (reaction-wheel control) over `elapsedSeconds`.
 *
 * Frozen above 1× warp: only translation, planet spin (analytic), and landed
 * co-rotation continue then — the vehicle's controlled attitude holds. At 1×
 * the integration is substepped so a long frame (stall or scheduler catch-up)
 * re-evaluates the controller per slice instead of taking one overshooting step.
 */
function advanceAttitude(
  elapsedSeconds: number,
  externalTorque: Vec3 = [0, 0, 0],
  inertiaTensor?: Mat3,
  inertiaInverse?: Mat3 | null,
): void {
  if (elapsedSeconds <= 0) return
  if (shouldStabilizeAngularVelocityForWarp(warpRate)) {
    commandedTorque = [0, 0, 0]
    return
  }
  if (!attitude) {
    // Degenerate path (no attitude model): treat manual torque as a direct rate.
    const torque = desiredControlTorque(orientation, angularVelocity, [0, 0, 0])
    commandedTorque = torque
    angularVelocity = torque
    orientation = integrateOrientation(orientation, angularVelocity, elapsedSeconds)
    return
  }
  const reactionWheelTorque = attitude.reactionWheelTorque
  const result = integrateAttitudeOverStep({
    orientation,
    angularVelocity,
    momentOfInertia: attitude.momentOfInertia,
    inertiaTensor,
    inertiaInverse,
    elapsedSeconds,
    // Reaction wheels run normally on every axis; the gimbal's torque arrives
    // via externalTorque. Both are just torques the integrator sums — no
    // actuator allocation is asserted (the gimbal naturally can't roll, so the
    // wheels cover it without being told to).
    torqueFor: (o, w) => desiredControlTorque(o, w, reactionWheelTorque),
    externalTorque,
  })
  // Guard against a pathological blow-up (e.g. a near-singular inertia tensor
  // through the gyroscopic term) producing a non-finite attitude. Commit only
  // finite results; otherwise hold the last good orientation and kill the rate,
  // so a NaN can never persist in worker state or reach the renderer.
  if (result.orientation.every(Number.isFinite) && result.angularVelocity.every(Number.isFinite)) {
    orientation = result.orientation
    angularVelocity = result.angularVelocity
    commandedTorque = result.lastTorque
  } else {
    angularVelocity = [0, 0, 0]
    commandedTorque = [0, 0, 0]
  }
}

/**
 * Desired control torque for a candidate (orientation, angularVelocity), shaped
 * to the given per-axis `maxTorque` budget. Used both by the reaction wheels
 * (budget = wheel torque) and the gimbal solver (budget unbounded — geometry +
 * deflection range are the real limit). Pure w.r.t. the args.
 *
 * Manual pilot input is a per-axis *rate command* the controller seeks with the
 * full available authority (so it works through a strong gimbal, not just as a
 * fixed wheel-sized nudge). On any axis the pilot is actively driving, the rate
 * command replaces the autopilot's hold — so a nudge under SAS/hold repositions
 * the craft, and the autopilot resumes that axis the moment the input is
 * released (holding the new attitude). Axes with no input keep the autopilot.
 */
function desiredControlTorque(currentOrientation: Quaternion, currentAngularVelocity: Vec3, maxTorque: Vec3): Vec3 {
  if (!attitude) return manualTorque

  // Autopilot's hold torque (none in plain manual mode).
  let base: Vec3 = [0, 0, 0]
  if (attitudeTarget.kind === 'damp') {
    base = angularVelocityDampingTorque({
      angularVelocity: currentAngularVelocity,
      maxTorque,
      momentOfInertia: attitude.momentOfInertia,
    })
  } else if (attitudeTarget.kind === 'seek-forward') {
    base = forwardDirectionHoldTorque({
      currentOrientation,
      targetForward: attitudeTarget.vector,
      angularVelocity: currentAngularVelocity,
      maxTorque,
      momentOfInertia: attitude.momentOfInertia,
    })
  }

  // Manual rate command: direction from the input, magnitude up to the manual
  // rate cap, ramped (tap = gentle, hold = builds to full).
  const rateCommand: Vec3 = [
    manualTorque[0] !== 0 ? Math.sign(manualTorque[0]) * MAX_MANUAL_ANGULAR_RATE * manualTorqueRampScale(manualHoldTime[0]) : 0,
    manualTorque[1] !== 0 ? Math.sign(manualTorque[1]) * MAX_MANUAL_ANGULAR_RATE * manualTorqueRampScale(manualHoldTime[1]) : 0,
    manualTorque[2] !== 0 ? Math.sign(manualTorque[2]) * MAX_MANUAL_ANGULAR_RATE * manualTorqueRampScale(manualHoldTime[2]) : 0,
  ]
  const manualSeek = angularRateSeekTorque({
    targetRate: rateCommand,
    angularVelocity: currentAngularVelocity,
    maxTorque,
    momentOfInertia: attitude.momentOfInertia,
  })
  // Per axis: pilot input overrides the autopilot; otherwise hold.
  return [
    manualTorque[0] !== 0 ? manualSeek[0] : base[0],
    manualTorque[1] !== 0 ? manualSeek[1] : base[1],
    manualTorque[2] !== 0 ? manualSeek[2] : base[2],
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
