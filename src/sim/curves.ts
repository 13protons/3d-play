import type { TrajectoryCurve } from './types'

/**
 * Evaluate a cubic Hermite spline at time t.
 * Returns position in the curve's parent-relative frame.
 */
export function evaluateCurve(
  curve: TrajectoryCurve,
  t: number,
): [number, number, number] {
  const dt = curve.t1 - curve.t0
  if (dt === 0) return curve.p1
  const s = (t - curve.t0) / dt
  const s2 = s * s
  const s3 = s2 * s

  // Hermite basis functions
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

/** Evaluate the derivative of a cubic Hermite spline at time t. */
export function evaluateCurveVelocity(
  curve: TrajectoryCurve,
  t: number,
): [number, number, number] {
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

/** Returns true if t is within the curve's validity window. */
export function isCurveValid(curve: TrajectoryCurve, t: number): boolean {
  return t >= curve.t0 && t <= curve.t1
}
