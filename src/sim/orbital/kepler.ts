/**
 * Keplerian orbit math — compute orbital elements from state vectors
 * and sample points along the predicted ellipse.
 *
 * This is a 2-body approximation for visualization only. The actual
 * simulation uses full n-body integration. Orbit lines will drift as
 * perturbations accumulate — that's a feature, not a bug.
 */

export interface OrbitalElements {
  a: number // semi-major axis (meters, negative for hyperbolic)
  e: number // eccentricity
  i: number // inclination (radians)
  lan: number // longitude of ascending node (radians)
  aop: number // argument of periapsis (radians)
  ta: number // true anomaly at current position (radians)
  mu: number // gravitational parameter GM
  pHat: [number, number, number] // periapsis direction in inertial y-up frame
  qHat: [number, number, number] // 90 degrees ahead in orbital plane
}

/** Cross product of two 3-vectors. */
function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function mag(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

function scale(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function normalize(v: [number, number, number]): [number, number, number] {
  const m = mag(v)
  return m > 1e-10 ? scale(v, 1 / m) : [1, 0, 0]
}


/**
 * Compute Keplerian orbital elements from position and velocity
 * relative to the parent body.
 *
 * @param r Position relative to parent (meters)
 * @param v Velocity relative to parent (m/s)
 * @param parentGm Parent gravitational parameter GM (m^3/s^2)
 */
export function stateToElements(
  r: [number, number, number],
  v: [number, number, number],
  parentGm: number,
): OrbitalElements {
  const mu = parentGm
  const rMag = mag(r)
  const vMag = mag(v)

  // Specific angular momentum: h = r × v
  const h = cross(r, v)
  const hMag = mag(h)

  // Node vector: n = ẑ × h (points toward ascending node)
  const zHat: [number, number, number] = [0, 1, 0] // y-up convention
  const n = cross(zHat, h)
  const nMag = mag(n)

  // Eccentricity vector: e = ((v² - μ/r)*r - (r·v)*v) / μ
  const rv = dot(r, v)
  const eVec: [number, number, number] = [
    ((vMag * vMag - mu / rMag) * r[0] - rv * v[0]) / mu,
    ((vMag * vMag - mu / rMag) * r[1] - rv * v[1]) / mu,
    ((vMag * vMag - mu / rMag) * r[2] - rv * v[2]) / mu,
  ]
  const e = mag(eVec)

  // Specific energy
  const energy = (vMag * vMag) / 2 - mu / rMag

  // Semi-major axis
  const a = Math.abs(energy) > 1e-10 ? -mu / (2 * energy) : Infinity

  // Inclination: angle between h and y-axis (y-up)
  const i = hMag > 1e-10 ? Math.acos(clamp(h[1] / hMag, -1, 1)) : 0

  // Longitude of ascending node
  let lan = 0
  if (nMag > 1e-10) {
    lan = Math.acos(clamp(n[0] / nMag, -1, 1))
    if (n[2] < 0) lan = 2 * Math.PI - lan
  }

  // Argument of periapsis
  let aop = 0
  if (nMag > 1e-10 && e > 1e-10) {
    aop = Math.acos(clamp(dot(n, eVec) / (nMag * e), -1, 1))
    if (eVec[1] < 0) aop = 2 * Math.PI - aop
  } else if (e > 1e-10) {
    // No inclination — measure from x-axis
    aop = Math.atan2(eVec[2], eVec[0])
    if (aop < 0) aop += 2 * Math.PI
  }

  const hHat = normalize(h)
  const pHat = e > 1e-10 ? normalize(eVec) : normalize(r)
  const qHat = normalize(cross(hHat, pHat))
  let ta = Math.atan2(dot(r, qHat), dot(r, pHat))
  if (ta < 0) ta += 2 * Math.PI

  return { a, e, i, lan, aop, ta, mu, pHat, qHat }
}

/**
 * Sample N points along a Keplerian orbit, returned as positions
 * relative to the parent body. Uses the perifocal frame rotation.
 */
export function sampleOrbit(
  elements: OrbitalElements,
  numPoints: number,
): [number, number, number][] {
  const anomalies: number[] = []
  for (let j = 0; j <= numPoints; j++) {
    anomalies.push((j / numPoints) * 2 * Math.PI)
  }
  return sampleOrbitAtTrueAnomalies(elements, anomalies)
}

export function sampleOrbitAtTrueAnomalies(
  elements: OrbitalElements,
  anomalies: number[],
): [number, number, number][] {
  const { a, e } = elements

  // Can't draw parabolic/infinite orbits or degenerate cases
  if (!Number.isFinite(a) || a <= 0 || e >= 1) return []

  const p = a * (1 - e * e) // semi-latus rectum

  const { pHat, qHat } = elements

  const points: [number, number, number][] = []

  for (const theta of anomalies) {
    const r = p / (1 + e * Math.cos(theta))

    // Position in perifocal frame
    const xP = r * Math.cos(theta)
    const yP = r * Math.sin(theta)

    // Transform to parent-centered inertial frame (y-up)
    points.push([
      pHat[0] * xP + qHat[0] * yP,
      pHat[1] * xP + qHat[1] * yP,
      pHat[2] * xP + qHat[2] * yP,
    ])
  }

  return points
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val))
}

/** Scalar orbital elements sufficient to reconstruct a state vector. */
export interface ElementVector {
  a: number // semi-major axis (meters)
  e: number // eccentricity
  i: number // inclination (radians)
  lan: number // longitude of ascending node (radians)
  aop: number // argument of periapsis (radians)
  ta: number // true anomaly (radians)
  mu: number // gravitational parameter GM
}

/**
 * Forward Keplerian: build a parent-relative state vector from scalar orbital
 * elements. Inverse of `stateToElements`, in the same y-up convention used
 * across the sim — reference (spin) axis is +y, the equatorial plane is x-z,
 * and the ascending node is measured from +x. Round-trips with
 * `stateToElements` for closed orbits.
 */
export function elementsToState(el: ElementVector): {
  position: [number, number, number]
  velocity: [number, number, number]
} {
  const { a, e, i, lan, aop, ta, mu } = el
  // Ascending node direction, in the equatorial (x-z) plane.
  const node: [number, number, number] = [Math.cos(lan), 0, Math.sin(lan)]
  // Orbit normal: tilt +y by the inclination about the node axis.
  const hHat = rotateAboutAxis([0, 1, 0], node, i)
  // Periapsis direction: rotate the node by argument of periapsis about ĥ.
  const pHat = rotateAboutAxis(node, hHat, aop)
  const qHat = normalize(cross(hHat, pHat))

  const p = a * (1 - e * e)
  const r = p / (1 + e * Math.cos(ta))
  const xP = r * Math.cos(ta)
  const yP = r * Math.sin(ta)
  const k = Math.sqrt(mu / p)
  const vxP = -k * Math.sin(ta)
  const vyP = k * (e + Math.cos(ta))

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
 * Inverse of `elementsToState` — decompose a parent-relative state vector into
 * scalar elements that `elementsToState` reconstructs exactly. Unlike
 * `stateToElements` (which serves orbit-line drawing and leaves `lan`/`aop`
 * degenerate for circular/equatorial orbits), this pair round-trips for every
 * closed orbit by folding undefined angles into a consistent reference: the
 * ascending node defaults to +x when equatorial, and periapsis defaults to the
 * node when circular, with `aop`/`ta` measured as signed rotations about ĥ.
 * Returns null for degenerate input (no angular momentum, e.g. a radial or
 * at-rest state) where no orbit is defined.
 */
export function stateToElementVector(
  r: [number, number, number],
  v: [number, number, number],
  mu: number,
): ElementVector | null {
  const rMag = mag(r)
  const vMag = mag(v)
  if (rMag < 1e-6 || mu <= 0) return null

  const h = cross(r, v)
  const hMag = mag(h)
  if (hMag < 1e-6) return null // radial / at-rest — no orbital plane
  const hHat = scale(h, 1 / hMag)

  const energy = (vMag * vMag) / 2 - mu / rMag
  const a = Math.abs(energy) > 1e-12 ? -mu / (2 * energy) : Infinity

  const rv = dot(r, v)
  const eVec: [number, number, number] = [
    ((vMag * vMag - mu / rMag) * r[0] - rv * v[0]) / mu,
    ((vMag * vMag - mu / rMag) * r[1] - rv * v[1]) / mu,
    ((vMag * vMag - mu / rMag) * r[2] - rv * v[2]) / mu,
  ]
  const e = mag(eVec)

  const i = Math.acos(clamp(hHat[1], -1, 1))

  // Ascending node in the x-z plane; defaults to +x when equatorial.
  let node = cross([0, 1, 0], hHat)
  if (mag(node) < 1e-8) node = [1, 0, 0]
  else node = normalize(node)
  const lan = Math.atan2(node[2], node[0])

  // Periapsis direction; defaults to the node when circular.
  const pHat = e > 1e-8 ? normalize(eVec) : node
  const aop = signedAngleAbout(node, pHat, hHat)
  const rHat = scale(r, 1 / rMag)
  const ta = signedAngleAbout(pHat, rHat, hHat)

  return { a, e, i, lan, aop, ta, mu }
}

/** Signed angle from `from` to `to` measured CCW about `axis` (all near-unit). */
function signedAngleAbout(
  from: [number, number, number],
  to: [number, number, number],
  axis: [number, number, number],
): number {
  return Math.atan2(dot(cross(from, to), axis), dot(from, to))
}

/** Rotate `v` about `axis` by `angle` radians (Rodrigues' formula). */
function rotateAboutAxis(
  v: [number, number, number],
  axis: [number, number, number],
  angle: number,
): [number, number, number] {
  const k = normalize(axis)
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const kv = cross(k, v)
  const kDotV = dot(k, v) * (1 - c)
  return [
    v[0] * c + kv[0] * s + k[0] * kDotV,
    v[1] * c + kv[1] * s + k[1] * kDotV,
    v[2] * c + kv[2] * s + k[2] * kDotV,
  ]
}
