export type Vec3 = [number, number, number]
export type FlightReferenceMode = 'orbital' | 'surface'

export interface FlightReferenceFrameInput {
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentRadius: number
  parentGm: number
  parentAngularVelocity: number
  parentRotationAxis: Vec3
  surfaceState: 'flying' | 'landed' | 'crashed'
  activationRadiusMultiplier?: number
}

export interface FlightReferenceFrame {
  mode: FlightReferenceMode
  altitude: number
  orbitalVelocity: Vec3
  surfaceVelocity: Vec3
  navVelocity: Vec3
  radialOut: Vec3
}

export function computeFlightReferenceFrame({
  relativePosition,
  relativeVelocity,
  parentRadius,
  parentGm,
  parentAngularVelocity,
  parentRotationAxis,
  surfaceState,
  activationRadiusMultiplier = 1.1,
}: FlightReferenceFrameInput): FlightReferenceFrame {
  const distance = magnitude(relativePosition)
  const radialOut = distance > 0 ? scale(relativePosition, 1 / distance) : [1, 0, 0] as Vec3
  const surfaceVelocity = subtract(
    relativeVelocity,
    cross(scale(parentRotationAxis, parentAngularVelocity), relativePosition),
  )
  const altitude = distance - parentRadius
  const closeToSurface = distance <= parentRadius * activationRadiusMultiplier
  const mode = surfaceState !== 'flying' || (closeToSurface && periapsisIntersectsBody({
    relativePosition,
    relativeVelocity,
    parentGm,
    parentRadius,
  }))
    ? 'surface'
    : 'orbital'

  return {
    mode,
    altitude,
    orbitalVelocity: relativeVelocity,
    surfaceVelocity,
    navVelocity: mode === 'surface' ? surfaceVelocity : relativeVelocity,
    radialOut,
  }
}

export function referenceFrameRetrogradeDirection(
  input: FlightReferenceFrameInput,
): Vec3 {
  const frame = computeFlightReferenceFrame(input)
  return normalize(scale(frame.navVelocity, -1), [0, 0, -1])
}

export function rotationAxisFromAxialTilt(axialTiltDegrees: number): Vec3 {
  const tilt = (axialTiltDegrees * Math.PI) / 180
  return normalize([-Math.sin(tilt), Math.cos(tilt), 0], [0, 1, 0])
}

function periapsisIntersectsBody({
  relativePosition,
  relativeVelocity,
  parentGm,
  parentRadius,
}: {
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentGm: number
  parentRadius: number
}): boolean {
  const r = magnitude(relativePosition)
  const v2 = dot(relativeVelocity, relativeVelocity)
  if (r <= 0 || parentGm <= 0) return false
  const specificEnergy = v2 / 2 - parentGm / r
  if (specificEnergy >= 0) return false

  const h = cross(relativePosition, relativeVelocity)
  const h2 = dot(h, h)
  const eccentricitySquared = Math.max(0, 1 + (2 * specificEnergy * h2) / (parentGm * parentGm))
  const eccentricity = Math.sqrt(eccentricitySquared)
  const semiMajorAxis = -parentGm / (2 * specificEnergy)
  const periapsis = semiMajorAxis * (1 - eccentricity)
  return periapsis <= parentRadius
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
