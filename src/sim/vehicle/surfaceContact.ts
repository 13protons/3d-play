export type Vec3 = [number, number, number]

export type SurfaceContact =
  | { type: 'flying' }
  | { type: 'landed'; surfaceNormal: Vec3; segmentT?: number }
  | { type: 'crashed'; surfaceNormal: Vec3; segmentT?: number }

export interface SurfaceState {
  position: Vec3
  velocity: Vec3
}

/**
 * A surface contact only counts as a landing when the craft is moving *toward* the
 * surface (negative radial velocity). A craft thrusting off the pad has zero/positive
 * radial velocity, so it's lifting off, not landing — it must not be re-grabbed, even
 * though its position still sits within the contact radius (which grows as fuel drains
 * and the CoM rises). `radialVelocity` is the velocity component along the outward
 * surface normal.
 */
export function isLandingDescent(
  contact: SurfaceContact,
  radialVelocity: number,
): contact is Exclude<SurfaceContact, { type: 'flying' }> {
  return contact.type !== 'flying' && radialVelocity < 0
}

export function classifySurfaceContact({
  relativePosition,
  relativeVelocity,
  parentRadius,
  landingSpeedThreshold,
}: {
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentRadius: number
  landingSpeedThreshold: number
}): SurfaceContact {
  const distance = mag(relativePosition)
  if (distance > parentRadius) return { type: 'flying' }

  const surfaceNormal = normalize(relativePosition, [1, 0, 0])
  const radialSpeed = dot(relativeVelocity, surfaceNormal)
  return Math.abs(Math.min(radialSpeed, 0)) <= landingSpeedThreshold
    ? { type: 'landed', surfaceNormal }
    : { type: 'crashed', surfaceNormal }
}

export function classifySurfaceContactAlongSegment({
  previousRelativePosition,
  currentRelativePosition,
  relativeVelocity,
  elapsedSeconds,
  parentRadius,
  landingSpeedThreshold,
}: {
  previousRelativePosition: Vec3
  currentRelativePosition: Vec3
  relativeVelocity: Vec3
  elapsedSeconds: number
  parentRadius: number
  landingSpeedThreshold: number
}): SurfaceContact {
  const crossing = firstSegmentSphereIntersection(
    previousRelativePosition,
    currentRelativePosition,
    parentRadius,
  )
  if (crossing) {
    return classifySurfacePoint(
      crossing.point,
      crossing.t === 0
        ? relativeVelocity
        : scale(subtract(currentRelativePosition, previousRelativePosition), 1 / Math.max(elapsedSeconds, 1e-9)),
      landingSpeedThreshold,
      crossing.t,
    )
  }

  const current = classifySurfaceContact({
    relativePosition: currentRelativePosition,
    relativeVelocity,
    parentRadius,
    landingSpeedThreshold,
  })
  if (current.type !== 'flying') return current
  return { type: 'flying' }
}

export function rotatingSurfaceState({
  landedAt,
  simTime,
  initialSurfaceNormal,
  parentPosition,
  parentVelocity,
  parentRadius,
  parentAngularVelocity,
  parentRotationAxis,
}: {
  landedAt: number
  simTime: number
  initialSurfaceNormal: Vec3
  parentPosition: Vec3
  parentVelocity: Vec3
  parentRadius: number
  parentAngularVelocity: number
  parentRotationAxis: Vec3
}): SurfaceState {
  const angle = parentAngularVelocity * (simTime - landedAt)
  const rotationAxis = normalize(parentRotationAxis, [0, 1, 0])
  const surfaceNormal = rotateAroundAxis(initialSurfaceNormal, rotationAxis, angle)
  return landedSurfaceState({
    parentPosition,
    parentVelocity,
    parentRadius,
    surfaceNormal,
    parentAngularVelocity,
    parentRotationAxis: rotationAxis,
  })
}

export function landedSurfaceState({
  parentPosition,
  parentVelocity,
  parentRadius,
  surfaceNormal,
  parentAngularVelocity,
  parentRotationAxis,
}: {
  parentPosition: Vec3
  parentVelocity: Vec3
  parentRadius: number
  surfaceNormal: Vec3
  parentAngularVelocity: number
  parentRotationAxis: Vec3
}): SurfaceState {
  const offset = scale(normalize(surfaceNormal, [1, 0, 0]), parentRadius)
  const axis = normalize(parentRotationAxis, [0, 1, 0])
  const surfaceVelocity = cross(scale(axis, parentAngularVelocity), offset)
  return {
    position: add(parentPosition, offset),
    velocity: add(parentVelocity, surfaceVelocity),
  }
}

function firstSegmentSphereIntersection(start: Vec3, end: Vec3, radius: number): { point: Vec3; t: number } | null {
  const delta = subtract(end, start)
  const a = dot(delta, delta)
  if (a <= 0) return null
  const b = 2 * dot(start, delta)
  const c = dot(start, start) - radius * radius
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((t) => {
      if (t > 1e-6 && t <= 1) return true
      if (Math.abs(t) <= 1e-6) {
        const normal = normalize(start, [1, 0, 0])
        return dot(delta, normal) < 0
      }
      return false
    })
    .sort((a, b) => a - b)
  const t = candidates[0]
  return t === undefined ? null : { point: add(start, scale(delta, t)), t: clean(t) }
}

function classifySurfacePoint(
  surfacePoint: Vec3,
  relativeVelocity: Vec3,
  landingSpeedThreshold: number,
  segmentT?: number,
): SurfaceContact {
  const surfaceNormal = normalize(surfacePoint, [1, 0, 0])
  const radialSpeed = dot(relativeVelocity, surfaceNormal)
  return Math.abs(Math.min(radialSpeed, 0)) <= landingSpeedThreshold
    ? { type: 'landed', surfaceNormal, segmentT }
    : { type: 'crashed', surfaceNormal, segmentT }
}

function rotateAroundAxis(vector: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const term1 = scale(vector, c)
  const term2 = scale(cross(axis, vector), s)
  const term3 = scale(axis, dot(axis, vector) * (1 - c))
  return [
    clean(term1[0] + term2[0] + term3[0]),
    clean(term1[1] + term2[1] + term3[1]),
    clean(term1[2] + term2[2] + term3[2]),
  ]
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(v: Vec3, scalar: number): Vec3 {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar]
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

function mag(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function normalize(v: Vec3, fallback: Vec3): Vec3 {
  const m = mag(v)
  if (m <= 0 || !Number.isFinite(m)) return fallback
  return [clean(v[0] / m), clean(v[1] / m), clean(v[2] / m)]
}

function clean(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}
