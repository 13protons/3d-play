export type Vec3 = [number, number, number]
export type FlightReferenceMode = 'orbital' | 'surface'
export type OrbitKind = 'closed' | 'open' | 'impacting'

export interface OrbitSummary {
  kind: OrbitKind
  periapsisAltitude: number
  apoapsisAltitude: number | null
}

export interface FlightReferenceFrameInput {
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentRadius: number
  parentGm: number
  parentAngularVelocity: number
  parentRotationAxis: Vec3
  surfaceState: 'flying' | 'landed' | 'crashed'
}

export interface FlightReferenceFrame {
  mode: FlightReferenceMode
  orbit: OrbitSummary
  altitude: number
  orbitalVelocity: Vec3
  surfaceVelocity: Vec3
  navVelocity: Vec3
  radialOut: Vec3
  /** Orbit-plane normal, normalize(cross(r, v_orbital)). Falls back to parent rotation axis when degenerate. */
  orbitNormal: Vec3
}

export function computeFlightReferenceFrame({
  relativePosition,
  relativeVelocity,
  parentRadius,
  parentGm,
  parentAngularVelocity,
  parentRotationAxis,
  surfaceState,
}: FlightReferenceFrameInput): FlightReferenceFrame {
  const distance = magnitude(relativePosition)
  const radialOut = distance > 0 ? scale(relativePosition, 1 / distance) : [1, 0, 0] as Vec3
  // A landed/crashed vehicle is rigidly attached to the surface, so its velocity
  // in the surface frame is exactly zero by definition. Force it — otherwise the
  // ω×r subtraction leaves floating-point noise that makes the navball's
  // prograde/retrograde markers jitter.
  const surfaceVelocity: Vec3 = surfaceState === 'flying'
    ? subtract(
        relativeVelocity,
        cross(scale(parentRotationAxis, parentAngularVelocity), relativePosition),
      )
    : [0, 0, 0]
  const altitude = distance - parentRadius
  const orbit = computeOrbitSummary({
    relativePosition,
    relativeVelocity,
    parentGm,
    parentRadius,
  })
  const mode = surfaceState !== 'flying' || orbit.kind === 'impacting'
    ? 'surface'
    : 'orbital'
  const orbitNormal = normalize(cross(relativePosition, relativeVelocity), parentRotationAxis)

  return {
    mode,
    orbit,
    altitude,
    orbitalVelocity: relativeVelocity,
    surfaceVelocity,
    navVelocity: mode === 'surface' ? surfaceVelocity : relativeVelocity,
    radialOut,
    orbitNormal,
  }
}

export function rotationAxisFromAxialTilt(axialTiltDegrees: number): Vec3 {
  const tilt = (axialTiltDegrees * Math.PI) / 180
  return normalize([-Math.sin(tilt), Math.cos(tilt), 0], [0, 1, 0])
}

function computeOrbitSummary({
  relativePosition,
  relativeVelocity,
  parentGm,
  parentRadius,
}: {
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentGm: number
  parentRadius: number
}): OrbitSummary {
  const r = magnitude(relativePosition)
  if (r <= 0 || parentGm <= 0) {
    return { kind: 'open', periapsisAltitude: Infinity, apoapsisAltitude: null }
  }

  const v2 = dot(relativeVelocity, relativeVelocity)
  const specificEnergy = v2 / 2 - parentGm / r
  const h = cross(relativePosition, relativeVelocity)
  const h2 = dot(h, h)
  const eccentricitySquared = Math.max(0, 1 + (2 * specificEnergy * h2) / (parentGm * parentGm))
  const eccentricity = Math.sqrt(eccentricitySquared)
  const periapsisRadius = h2 / (parentGm * (1 + eccentricity))
  const semiMajorAxis = specificEnergy < 0 ? -parentGm / (2 * specificEnergy) : null
  const apoapsisRadius = semiMajorAxis === null ? null : 2 * semiMajorAxis - periapsisRadius
  const periapsisAltitude = periapsisRadius - parentRadius
  const apoapsisAltitude = apoapsisRadius === null ? null : apoapsisRadius - parentRadius

  return {
    kind: periapsisRadius <= parentRadius ? 'impacting' : specificEnergy < 0 ? 'closed' : 'open',
    periapsisAltitude,
    apoapsisAltitude,
  }
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
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

function magnitude(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function normalize(v: Vec3, fallback: Vec3): Vec3 {
  const m = magnitude(v)
  return m > 0 && Number.isFinite(m) ? scale(v, 1 / m) : fallback
}
