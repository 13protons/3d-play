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

/** Returns true if t is within the curve's validity window. */
export function isCurveValid(curve: TrajectoryCurve, t: number): boolean {
  return t >= curve.t0 && t <= curve.t1
}
