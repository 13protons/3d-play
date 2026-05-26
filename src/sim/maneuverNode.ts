import type { OrbitalElements } from './orbital/kepler'

export type Vec3 = [number, number, number]

export interface ManeuverDeltaV {
  /** m/s along the prograde direction at the node. */
  prograde: number
  /** m/s along the orbit-plane normal (h-hat). */
  normal: number
  /** m/s in the orbital plane, perpendicular to prograde (≈ radial-out for circular orbits). */
  radial: number
}

export interface ManeuverNode {
  id: string
  vesselId: string
  /** Absolute sim time of the burn. */
  simTime: number
  deltaV: ManeuverDeltaV
}

export interface ManeuverState {
  position: Vec3
  velocity: Vec3
}

/** Mean motion for a closed orbit (rad/s). */
function meanMotion(elements: OrbitalElements): number {
  return Math.sqrt(elements.mu / (elements.a * elements.a * elements.a))
}

/**
 * Solve Kepler's equation M = E - e·sin(E) by Newton iteration.
 */
export function eccentricAnomalyFromMean(meanAnomaly: number, eccentricity: number): number {
  let E = meanAnomaly
  for (let i = 0; i < 32; i++) {
    const f = E - eccentricity * Math.sin(E) - meanAnomaly
    const fp = 1 - eccentricity * Math.cos(E)
    const step = f / fp
    E -= step
    if (Math.abs(step) < 1e-12) break
  }
  return E
}

/**
 * True anomaly at the moment the closed orbit reaches `targetSimTime`.
 * Returns null for open / degenerate orbits.
 */
export function anomalyAtTime(
  elements: OrbitalElements,
  currentSimTime: number,
  targetSimTime: number,
): number | null {
  if (!Number.isFinite(elements.a) || elements.a <= 0 || elements.e >= 1) return null
  const n = meanMotion(elements)
  if (!Number.isFinite(n) || n <= 0) return null
  const twoPi = 2 * Math.PI
  const m0 = meanAnomalyFromTrue(elements.ta, elements.e)
  const m = m0 + n * (targetSimTime - currentSimTime)
  const E = eccentricAnomalyFromMean(m, elements.e)
  let ta = 2 * Math.atan2(
    Math.sqrt(1 + elements.e) * Math.sin(E / 2),
    Math.sqrt(1 - elements.e) * Math.cos(E / 2),
  )
  ta = ((ta % twoPi) + twoPi) % twoPi
  return ta
}

/** True anomaly → eccentric anomaly → mean anomaly. */
export function meanAnomalyFromTrue(trueAnomaly: number, eccentricity: number): number {
  const e = eccentricity
  const E = 2 * Math.atan2(
    Math.sqrt(1 - e) * Math.sin(trueAnomaly / 2),
    Math.sqrt(1 + e) * Math.cos(trueAnomaly / 2),
  )
  return E - e * Math.sin(E)
}

/**
 * Sim time at which the vehicle will next reach `targetTrueAnomaly` along its
 * current closed orbit. Returns null for open / degenerate orbits.
 */
export function timeAtAnomaly(
  elements: OrbitalElements,
  currentSimTime: number,
  targetTrueAnomaly: number,
): number | null {
  if (!Number.isFinite(elements.a) || elements.a <= 0 || elements.e >= 1) return null
  const n = meanMotion(elements)
  if (!Number.isFinite(n) || n <= 0) return null
  const m0 = meanAnomalyFromTrue(elements.ta, elements.e)
  const m1 = meanAnomalyFromTrue(targetTrueAnomaly, elements.e)
  const twoPi = 2 * Math.PI
  let dM = ((m1 - m0) % twoPi + twoPi) % twoPi
  // dM == 0 means "right now" — bump to next revolution so the node lands ahead.
  if (dM < 1e-9) dM += twoPi
  return currentSimTime + dM / n
}

/**
 * Project a parent-relative point onto the orbital plane and return its
 * true anomaly. The point need not lie exactly on the orbit — useful for
 * snapping a click on the orbit line to the underlying ellipse.
 */
export function nearestAnomalyToPoint(
  elements: OrbitalElements,
  pointParentRelative: Vec3,
): number {
  const x = dot(pointParentRelative, elements.pHat)
  const y = dot(pointParentRelative, elements.qHat)
  let ta = Math.atan2(y, x)
  if (ta < 0) ta += 2 * Math.PI
  return ta
}

/**
 * Position + velocity along the orbit at the given true anomaly, in the
 * parent-relative frame.
 */
export function stateAtAnomaly(
  elements: OrbitalElements,
  trueAnomaly: number,
): ManeuverState {
  const { a, e, mu, pHat, qHat } = elements
  const p = a * (1 - e * e)
  const r = p / (1 + e * Math.cos(trueAnomaly))
  const xP = r * Math.cos(trueAnomaly)
  const yP = r * Math.sin(trueAnomaly)
  const k = Math.sqrt(mu / p)
  const vxP = -k * Math.sin(trueAnomaly)
  const vyP = k * (e + Math.cos(trueAnomaly))
  return {
    position: [
      pHat[0] * xP + qHat[0] * yP,
      pHat[1] * xP + qHat[1] * yP,
      pHat[2] * xP + qHat[2] * yP,
    ],
    velocity: [
      pHat[0] * vxP + qHat[0] * vyP,
      pHat[1] * vxP + qHat[1] * vyP,
      pHat[2] * vxP + qHat[2] * vyP,
    ],
  }
}

/**
 * Apply a maneuver deltaV (in prograde/normal/radial frame at the node)
 * to a state vector, returning the new velocity.
 */
export function applyManeuverDeltaV(
  state: ManeuverState,
  deltaV: ManeuverDeltaV,
): Vec3 {
  const v = state.velocity
  const vMag = Math.hypot(v[0], v[1], v[2])
  if (vMag < 1e-10) return v
  const prograde: Vec3 = [v[0] / vMag, v[1] / vMag, v[2] / vMag]
  const h = cross(state.position, v)
  const normal = normalize(h)
  const radial = cross(normal, prograde)
  return [
    v[0] + deltaV.prograde * prograde[0] + deltaV.normal * normal[0] + deltaV.radial * radial[0],
    v[1] + deltaV.prograde * prograde[1] + deltaV.normal * normal[1] + deltaV.radial * radial[1],
    v[2] + deltaV.prograde * prograde[2] + deltaV.normal * normal[2] + deltaV.radial * radial[2],
  ]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function normalize(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2])
  if (m < 1e-10 || !Number.isFinite(m)) return [1, 0, 0]
  return [v[0] / m, v[1] / m, v[2] / m]
}
