export const RCS_ANGULAR_RATE = 0.25
export const REACTION_WHEEL_ANGULAR_RATE = RCS_ANGULAR_RATE
export const MAIN_THRUST_ACCELERATION = 25

export type Quaternion = [number, number, number, number]
export type Vec3 = [number, number, number]

export function angularVelocityForRcsKeys(keys: Set<string>): Vec3 {
  return angularVelocityForReactionWheelKeys(keys)
}

export function angularVelocityForReactionWheelKeys(keys: Set<string>): Vec3 {
  const has = (key: string) => keys.has(key.toLowerCase())
  return [
    axisValue(has('w'), has('s')) * REACTION_WHEEL_ANGULAR_RATE,
    axisValue(has('d'), has('a')) * REACTION_WHEEL_ANGULAR_RATE,
    axisValue(has('e'), has('q')) * REACTION_WHEEL_ANGULAR_RATE,
  ]
}

export function shouldStabilizeAngularVelocityForWarp(warpRate: number): boolean {
  return warpRate > 1
}

export function shouldDisableThrottleForWarp(warpRate: number): boolean {
  return warpRate > 1
}

export function toggleThrottle(currentThrottle: number): number {
  return currentThrottle > 0 ? 0 : 1
}

export function thrustAccelerationForOrientation(
  orientation: Quaternion,
  throttle: number,
): Vec3 {
  if (throttle <= 0) return [0, 0, 0]
  const forward = rotateVectorByQuaternion([0, 0, 1], orientation)
  const accel = MAIN_THRUST_ACCELERATION * throttle
  return [forward[0] * accel, forward[1] * accel, forward[2] * accel]
}

export function thrustAccelerationForElapsedRotation(
  orientation: Quaternion,
  angularVelocity: Vec3,
  elapsedSeconds: number,
  throttle: number,
): Vec3 {
  return thrustAccelerationForOrientation(
    integrateOrientation(orientation, angularVelocity, elapsedSeconds),
    throttle,
  )
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

function multiplyQuaternions(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

function normalizeQuaternion(q: Quaternion): Quaternion {
  const m = Math.hypot(q[0], q[1], q[2], q[3])
  return m > 0 ? [q[0] / m, q[1] / m, q[2] / m, q[3] / m] : [0, 0, 0, 1]
}
