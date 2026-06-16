export const RCS_ANGULAR_RATE = 0.25
export const REACTION_WHEEL_ANGULAR_RATE = RCS_ANGULAR_RATE
export const THROTTLE_RAMP_RATE = 0.5

/** Default cap on autopilot slew rate (rad/s) so high-torque craft don't slam the target. */
export const MAX_AUTOPILOT_ANGULAR_RATE = 0.6
/** Cap on manual reaction-wheel slew rate (rad/s, ≈26°/s) so held keys can't spin up forever. */
export const MAX_MANUAL_ANGULAR_RATE = 0.45
/** Continuous hold time (s) for manual torque to ramp from its floor up to full authority. */
export const MANUAL_TORQUE_RAMP_SECONDS = 1.0
/** Torque fraction applied the instant a key is pressed — a quick tap is gentle, holding builds up. */
export const MANUAL_TORQUE_MIN_SCALE = 0.15
/**
 * Fraction of available angular acceleration the brake curve assumes. < 1 so
 * commanding full torque always decelerates *faster* than the planned curve,
 * which guarantees the craft stops short of the target instead of overshooting.
 */
const SLEW_BRAKE_SAFETY = 0.9
/**
 * Rate-error → torque stiffness. The controller commands a target angular rate,
 * then drives the actual rate toward it; this gain saturates to max torque
 * outside a thin boundary layer (half-width ≈ αmax / gain), so the approach is
 * effectively bang-bang far out and critically damped near the target.
 */
const SLEW_RATE_GAIN = 6
/**
 * Rate-per-radian gain used inside a small region around the target, where the
 * sqrt brake curve's near-infinite slope would otherwise chatter in discrete
 * time. Set to SLEW_RATE_GAIN / 4 so the combined outer (angle) + inner (rate)
 * loop is critically damped (ζ = 1) in this linear region — no overshoot, no
 * creep. Far from the target the sqrt brake curve dominates instead.
 */
const SLEW_LINEAR_RATE_GAIN = SLEW_RATE_GAIN / 4

export type Quaternion = [number, number, number, number]
export type Vec3 = [number, number, number]
export interface ThrustModel {
  maxThrust: number
  mass: number
}

export interface AttitudeHoldInput {
  currentOrientation: Quaternion
  targetOrientation: Quaternion
  angularVelocity: Vec3
  maxTorque: Vec3
  momentOfInertia?: Vec3
  kp?: number
  kd?: number
}

export interface AngularVelocityDampingInput {
  angularVelocity: Vec3
  maxTorque: Vec3
  momentOfInertia: Vec3
  dampingFrequency?: number
}

export interface ForwardDirectionHoldInput {
  currentOrientation: Quaternion
  targetForward: Vec3
  angularVelocity: Vec3
  maxTorque: Vec3
  momentOfInertia: Vec3
  maxAngularRate?: number
}

export interface ManualReactionWheelInput {
  commandTorque: Vec3
  angularVelocity: Vec3
}

export interface PidStepInput {
  error: number
  integral: number
  derivative: number
  kp: number
  ki: number
  kd: number
  maxOutput: number
}

export function angularVelocityForReactionWheelKeys(keys: Set<string>): Vec3 {
  const has = (key: string) => keys.has(key.toLowerCase())
  return [
    axisValue(has('w'), has('s')) * REACTION_WHEEL_ANGULAR_RATE,
    axisValue(has('d'), has('a')) * REACTION_WHEEL_ANGULAR_RATE,
    axisValue(has('e'), has('q')) * REACTION_WHEEL_ANGULAR_RATE,
  ]
}

export function reactionWheelTorqueForKeys(
  keys: Set<string>,
  reactionWheelTorque: Vec3,
): Vec3 {
  const has = (key: string) => keys.has(key.toLowerCase())
  return [
    axisValue(has('w'), has('s')) * reactionWheelTorque[0],
    axisValue(has('d'), has('a')) * reactionWheelTorque[1],
    axisValue(has('e'), has('q')) * reactionWheelTorque[2],
  ]
}

export function angularVelocityAfterTorque(
  current: Vec3,
  torque: Vec3,
  momentOfInertia: Vec3,
  dt: number,
): Vec3 {
  return [
    current[0] + (torque[0] / momentOfInertia[0]) * dt,
    current[1] + (torque[1] / momentOfInertia[1]) * dt,
    current[2] + (torque[2] / momentOfInertia[2]) * dt,
  ]
}

export function manualReactionWheelTorque({
  commandTorque,
}: ManualReactionWheelInput): Vec3 {
  return commandTorque
}

/**
 * Ramp factor (minScale..1) for manual reaction-wheel torque given how long the
 * input has been held continuously. A quick tap applies only `minScale` of the
 * torque; holding for `rampSeconds` builds up to full authority — like pointer
 * acceleration, so fine nudges and large slews share one key.
 */
export function manualTorqueRampScale(
  holdSeconds: number,
  rampSeconds = MANUAL_TORQUE_RAMP_SECONDS,
  minScale = MANUAL_TORQUE_MIN_SCALE,
): number {
  if (!(holdSeconds > 0)) return minScale
  if (!(rampSeconds > 0)) return 1
  return clamp(minScale + (1 - minScale) * (holdSeconds / rampSeconds), minScale, 1)
}

/** Apply each axis's hold-duration ramp to a manual torque command. */
export function rampManualTorque(torque: Vec3, holdSeconds: Vec3): Vec3 {
  return [
    torque[0] * manualTorqueRampScale(holdSeconds[0]),
    torque[1] * manualTorqueRampScale(holdSeconds[1]),
    torque[2] * manualTorqueRampScale(holdSeconds[2]),
  ]
}

/**
 * Zero any torque component that would push an axis past ±maxRate in the
 * direction it is already spinning. Torque opposing the current spin (braking)
 * always passes through, and releasing input (zero torque) is untouched — so
 * this caps manual slew rate without adding auto-braking on release.
 */
export function limitTorqueToAngularRate(
  torque: Vec3,
  angularVelocity: Vec3,
  maxRate: number,
): Vec3 {
  const limit = (axis: number): number => {
    const t = torque[axis]
    const w = angularVelocity[axis]
    if (t > 0 && w >= maxRate) return 0
    if (t < 0 && w <= -maxRate) return 0
    return t
  }
  return [limit(0), limit(1), limit(2)]
}

/**
 * Advance per-axis manual-hold timers by `elapsedSeconds`: an axis with active
 * manual torque accumulates hold time (driving the ramp), an idle axis resets.
 */
export function advanceManualHoldTime(
  holdSeconds: Vec3,
  manualTorque: Vec3,
  elapsedSeconds: number,
): Vec3 {
  return [
    manualTorque[0] !== 0 ? holdSeconds[0] + elapsedSeconds : 0,
    manualTorque[1] !== 0 ? holdSeconds[1] + elapsedSeconds : 0,
    manualTorque[2] !== 0 ? holdSeconds[2] + elapsedSeconds : 0,
  ]
}

export function sumAndClampTorque(a: Vec3, b: Vec3, maxTorque: Vec3): Vec3 {
  return [
    clamp(a[0] + b[0], -maxTorque[0], maxTorque[0]),
    clamp(a[1] + b[1], -maxTorque[1], maxTorque[1]),
    clamp(a[2] + b[2], -maxTorque[2], maxTorque[2]),
  ]
}

export function angularVelocityDampingTorque({
  angularVelocity,
  maxTorque,
  momentOfInertia,
  dampingFrequency = 2,
}: AngularVelocityDampingInput): Vec3 {
  const damp = (axis: number) => cleanZero(clamp(
    -angularVelocity[axis] * momentOfInertia[axis] * dampingFrequency,
    -maxTorque[axis],
    maxTorque[axis],
  ))
  return [
    damp(0),
    damp(1),
    damp(2),
  ]
}

export function forwardDirectionHoldTorque({
  currentOrientation,
  targetForward,
  angularVelocity,
  maxTorque,
  momentOfInertia,
  maxAngularRate = MAX_AUTOPILOT_ANGULAR_RATE,
}: ForwardDirectionHoldInput): Vec3 {
  const targetLocal = rotateVectorByQuaternion(normalizeVec3(targetForward, [0, 0, 1]), conjugateQuaternion(currentOrientation))
  const error = forwardAlignmentError(targetLocal)
  return [
    slewAxisTorque(error[0], angularVelocity[0], maxTorque[0], momentOfInertia[0], maxAngularRate),
    slewAxisTorque(error[1], angularVelocity[1], maxTorque[1], momentOfInertia[1], maxAngularRate),
    // Roll has no orientation target (zero error) — damp the rate only.
    slewAxisTorque(0, angularVelocity[2], maxTorque[2], momentOfInertia[2], maxAngularRate),
  ]
}

/**
 * Slew-rate-limited reaction-wheel torque for a single axis.
 *
 * Instead of a linear PD law (which saturates on large slews and overshoots
 * because it can't brake in time at high inertia), this commands a target
 * angular rate from a "brake curve" — the fastest rate from which the axis can
 * still decelerate to a stop within the remaining `error`, given the available
 * angular acceleration. The rate is clamped to `maxAngularRate`, then a stiff
 * inner loop drives the actual rate toward it. With a sub-unity safety factor
 * on the brake curve, commanding full torque always over-brakes the plan, so
 * the axis converges without overshoot regardless of inertia or wheel torque.
 */
export function slewAxisTorque(
  error: number,
  angularVelocity: number,
  maxTorque: number,
  momentOfInertia: number,
  maxAngularRate: number,
): number {
  if (!(maxTorque > 0) || !(momentOfInertia > 0)) return 0
  const angularAccelMax = maxTorque / momentOfInertia
  const magnitude = Math.abs(error)
  // Brake curve far out; linear ramp near the target; never exceed the rate cap.
  const brakeRate = Math.sqrt(2 * angularAccelMax * SLEW_BRAKE_SAFETY * magnitude)
  const linearRate = SLEW_LINEAR_RATE_GAIN * magnitude
  const speed = Math.min(maxAngularRate, brakeRate, linearRate)
  const desiredRate = Math.sign(error) * speed
  const torque = momentOfInertia * SLEW_RATE_GAIN * (desiredRate - angularVelocity)
  return cleanZero(clamp(torque, -maxTorque, maxTorque))
}

/**
 * Rotation-vector error (axis * angle, in radians) that takes local +Z onto
 * targetLocal. Magnitude grows linearly with the angle, avoiding the sin(θ)
 * collapse of a bare cross product at 180° — without that the autopilot would
 * stall when asked to flip to the opposite direction.
 */
export function forwardAlignmentError(targetLocal: Vec3): Vec3 {
  const crossError = cross([0, 0, 1], targetLocal)
  const sinTheta = Math.hypot(crossError[0], crossError[1], crossError[2])
  const cosTheta = targetLocal[2]
  if (sinTheta < 1e-6) {
    // Either aligned or antipodal. Antipodal: pick any perpendicular axis and
    // command a half-turn. Aligned: zero error.
    return cosTheta < 0 ? [Math.PI, 0, 0] : [0, 0, 0]
  }
  const angle = Math.atan2(sinTheta, cosTheta)
  const scale = angle / sinTheta
  return [crossError[0] * scale, crossError[1] * scale, crossError[2] * scale]
}

export function attitudeHoldTorque({
  currentOrientation,
  targetOrientation,
  angularVelocity,
  maxTorque,
  momentOfInertia,
  kp = 8,
  kd = 10,
}: AttitudeHoldInput): Vec3 {
  const error = multiplyQuaternions(conjugateQuaternion(currentOrientation), targetOrientation)
  const sign = error[3] < 0 ? -1 : 1
  const naturalFrequency = 2
  const axisGain = (axis: number): { kp: number, kd: number } => {
    const inertia = momentOfInertia?.[axis]
    if (!inertia) return { kp, kd }
    return {
      kp: inertia * naturalFrequency * naturalFrequency,
      kd: 2 * inertia * naturalFrequency,
    }
  }
  const x = axisGain(0)
  const y = axisGain(1)
  const z = axisGain(2)
  return [
    pidStep({ error: error[0] * 2 * sign, integral: 0, derivative: -angularVelocity[0], kp: x.kp, ki: 0, kd: x.kd, maxOutput: maxTorque[0] }),
    pidStep({ error: error[1] * 2 * sign, integral: 0, derivative: -angularVelocity[1], kp: y.kp, ki: 0, kd: y.kd, maxOutput: maxTorque[1] }),
    pidStep({ error: error[2] * 2 * sign, integral: 0, derivative: -angularVelocity[2], kp: z.kp, ki: 0, kd: z.kd, maxOutput: maxTorque[2] }),
  ]
}

export function pidStep({
  error,
  integral,
  derivative,
  kp,
  ki,
  kd,
  maxOutput,
}: PidStepInput): number {
  return clamp(kp * error + ki * integral + kd * derivative, -maxOutput, maxOutput)
}

export function shouldStabilizeAngularVelocityForWarp(warpRate: number): boolean {
  return warpRate > 1
}

export function shouldDisableThrottleForWarp(warpRate: number): boolean {
  return warpRate > 1
}

export function shouldEmitAeroForce(force: Vec3): boolean {
  return force.every(Number.isFinite) && Math.hypot(force[0], force[1], force[2]) > 0
}

export function toggleThrottle(currentThrottle: number): number {
  return currentThrottle > 0 ? 0 : 1
}

export function adjustThrottle(
  currentThrottle: number,
  direction: -1 | 0 | 1,
  elapsedSeconds: number,
  rampRate = THROTTLE_RAMP_RATE,
): number {
  return clamp(currentThrottle + direction * rampRate * elapsedSeconds, 0, 1)
}

export function throttleFull(): number {
  return 1
}

export function throttleCut(): number {
  return 0
}

export function thrustAccelerationForOrientation(
  orientation: Quaternion,
  throttle: number,
  thrustModel?: ThrustModel,
): Vec3 {
  if (throttle <= 0 || !thrustModel || thrustModel.mass <= 0) return [0, 0, 0]
  const forward = rotateVectorByQuaternion([0, 0, 1], orientation)
  const accel = (thrustModel.maxThrust / thrustModel.mass) * throttle
  return [forward[0] * accel, forward[1] * accel, forward[2] * accel]
}

export function thrustAccelerationForElapsedRotation(
  orientation: Quaternion,
  angularVelocity: Vec3,
  elapsedSeconds: number,
  throttle: number,
  thrustModel?: ThrustModel,
): Vec3 {
  return thrustAccelerationForOrientation(
    integrateOrientation(orientation, angularVelocity, elapsedSeconds),
    throttle,
    thrustModel,
  )
}

/**
 * Pre-multiplies orientation by a rotation of `angle` radians around a
 * world-frame axis. Use when something external to the vehicle (e.g. the
 * surface a landed vessel is glued to) needs to drag the orientation along.
 */
export function rotateOrientationAroundWorldAxis(
  orientation: Quaternion,
  axis: Vec3,
  angle: number,
): Quaternion {
  if (angle === 0) return orientation
  const magnitude = Math.hypot(axis[0], axis[1], axis[2])
  if (magnitude === 0) return orientation
  const half = angle / 2
  const s = Math.sin(half) / magnitude
  const delta: Quaternion = [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)]
  return normalizeQuaternion(multiplyQuaternions(delta, orientation))
}

export function integrateOrientation(
  orientation: Quaternion,
  angularVelocity: Vec3,
  dt: number,
): Quaternion {
  const speed = Math.hypot(...angularVelocity)
  if (speed <= 0 || dt <= 0) return orientation
  const halfAngle = (speed * dt) / 2
  const s = Math.sin(halfAngle) / speed
  const delta: Quaternion = [
    angularVelocity[0] * s,
    angularVelocity[1] * s,
    angularVelocity[2] * s,
    Math.cos(halfAngle),
  ]
  return normalizeQuaternion(multiplyQuaternions(orientation, delta))
}

function axisValue(positive: boolean, negative: boolean): number {
  if (positive === negative) return 0
  return positive ? 1 : -1
}

function rotateVectorByQuaternion(vector: Vec3, q: Quaternion): Vec3 {
  const [x, y, z] = vector
  const [qx, qy, qz, qw] = q

  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

function normalizeVec3(vector: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2])
  return magnitude > 0 && Number.isFinite(magnitude)
    ? [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
    : fallback
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

export function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export function conjugateQuaternion(q: Quaternion): Quaternion {
  return [-q[0], -q[1], -q[2], q[3]]
}

export function normalizeQuaternion(q: Quaternion): Quaternion {
  const m = Math.hypot(q[0], q[1], q[2], q[3])
  return m > 0 ? [q[0] / m, q[1] / m, q[2] / m, q[3] / m] : [0, 0, 0, 1]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}
