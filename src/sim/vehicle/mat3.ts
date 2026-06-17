/**
 * Small 3-vector / 3×3-matrix linear algebra for the vehicle rigid-body spine:
 * mass-property aggregation (parallel-axis inertia) and the full-tensor attitude
 * integrator (I⁻¹·τ, ω×(Iω)). Pure, allocation-light, no external state.
 *
 * Matrices are row-major flat 9-tuples; inertia tensors are symmetric but stored
 * as full Mat3 because parallel-axis and rotation produce general symmetric forms
 * and a uniform type keeps the math readable.
 */

export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]
/** Row-major: [m00, m01, m02, m10, m11, m12, m20, m21, m22]. */
export type Mat3 = [number, number, number, number, number, number, number, number, number]

export const MAT3_ZERO: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
export const MAT3_IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

// --- Vec3 ------------------------------------------------------------------

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function vec3Scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

export function vec3LengthSq(a: Vec3): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2]
}

// --- Mat3 ------------------------------------------------------------------

export function mat3Add(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] + b[0], a[1] + b[1], a[2] + b[2],
    a[3] + b[3], a[4] + b[4], a[5] + b[5],
    a[6] + b[6], a[7] + b[7], a[8] + b[8],
  ]
}

export function mat3Sub(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] - b[0], a[1] - b[1], a[2] - b[2],
    a[3] - b[3], a[4] - b[4], a[5] - b[5],
    a[6] - b[6], a[7] - b[7], a[8] - b[8],
  ]
}

export function mat3Scale(m: Mat3, s: number): Mat3 {
  return [m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s, m[5] * s, m[6] * s, m[7] * s, m[8] * s]
}

export function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ]
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
    a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
    a[0] * b[2] + a[1] * b[5] + a[2] * b[8],

    a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
    a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
    a[3] * b[2] + a[4] * b[5] + a[5] * b[8],

    a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
    a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
    a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ]
}

export function mat3Transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

export function mat3Determinant(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

/**
 * Inverse via the adjugate / determinant. Returns null for a singular (or
 * near-singular) matrix so callers can fall back rather than emit NaNs — a
 * degenerate inertia tensor (e.g. a single point mass) has no well-defined I⁻¹.
 */
export function mat3Inverse(m: Mat3): Mat3 | null {
  const c00 = m[4] * m[8] - m[5] * m[7]
  const c01 = m[5] * m[6] - m[3] * m[8]
  const c02 = m[3] * m[7] - m[4] * m[6]
  const det = m[0] * c00 + m[1] * c01 + m[2] * c02
  if (!Number.isFinite(det) || det === 0) return null
  const inv = 1 / det
  const c10 = m[2] * m[7] - m[1] * m[8]
  const c11 = m[0] * m[8] - m[2] * m[6]
  const c12 = m[1] * m[6] - m[0] * m[7]
  const c20 = m[1] * m[5] - m[2] * m[4]
  const c21 = m[2] * m[3] - m[0] * m[5]
  const c22 = m[0] * m[4] - m[1] * m[3]
  return [
    c00 * inv, c10 * inv, c20 * inv,
    c01 * inv, c11 * inv, c21 * inv,
    c02 * inv, c12 * inv, c22 * inv,
  ]
}

/** Rotation matrix for a unit quaternion [x, y, z, w]. */
export function mat3FromQuaternion(q: Quaternion): Mat3 {
  const [x, y, z, w] = q
  const xx = x * x, yy = y * y, zz = z * z
  const xy = x * y, xz = x * z, yz = y * z
  const wx = w * x, wy = w * y, wz = w * z
  return [
    1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
    2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
    2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy),
  ]
}

/**
 * Inertia tensor of a *unit* point mass at `r` about the origin: |r|²·I − r⊗r.
 * Multiply by the mass for the real contribution. This is also exactly the
 * parallel-axis shift term per unit mass, so a draining tank's fuel contributes
 * `fuel · pointMassInertiaUnit(tankPos)` with no extra shift.
 */
export function pointMassInertiaUnit(r: Vec3): Mat3 {
  const [x, y, z] = r
  const r2 = x * x + y * y + z * z
  return [
    r2 - x * x, -x * y, -x * z,
    -x * y, r2 - y * y, -y * z,
    -x * z, -y * z, r2 - z * z,
  ]
}

/** Parallel-axis term M·(|d|²·I − d⊗d) for shifting an inertia tensor by `d`. */
export function parallelAxisTerm(mass: number, d: Vec3): Mat3 {
  return mat3Scale(pointMassInertiaUnit(d), mass)
}
