import { surfaceFrame } from '../sim/vehicle/referenceFrame'

export type Vec3 = [number, number, number]
export type Quaternion = [number, number, number, number]

export interface NavballFrame {
  prograde: Vec3
  retrograde: Vec3
  radialOut: Vec3
  radialIn: Vec3
  normal: Vec3
  antiNormal: Vec3
}

export interface NavballCompassFrame {
  north: Vec3
  east: Vec3
  south: Vec3
  west: Vec3
}

export interface ProjectedNavballPoint {
  x: number
  y: number
  visible: boolean
}

export type NavballMarkers = Record<keyof NavballFrame, ProjectedNavballPoint> & {
  /** Present only when a maneuver direction was provided to the navball. */
  maneuver?: ProjectedNavballPoint
}
export type NavballCompassMarkers = Record<keyof NavballCompassFrame, ProjectedNavballPoint>

export interface NavballState {
  markers: NavballMarkers
  compass: NavballCompassMarkers | null
  horizon: ProjectedNavballPoint[]
  /** Great-circle meridians through the up/down poles (N-S and E-W), rotating
   * with the sphere — the moving grid that replaces the old static cross. */
  meridians: ProjectedNavballPoint[][]
  /** "Sky" hemisphere polygon (toward radialOut) for attitude-indicator shading. */
  sky: ScreenPoint[]
}

export function eulerDegreesToQuaternion({
  yaw,
  pitch,
  roll,
}: {
  yaw: number
  pitch: number
  roll: number
}): Quaternion {
  const halfYaw = degreesToRadians(yaw) / 2
  const halfPitch = degreesToRadians(pitch) / 2
  const halfRoll = degreesToRadians(roll) / 2
  const yawQ: Quaternion = [0, Math.sin(halfYaw), 0, Math.cos(halfYaw)]
  const pitchQ: Quaternion = [Math.sin(halfPitch), 0, 0, Math.cos(halfPitch)]
  const rollQ: Quaternion = [0, 0, Math.sin(halfRoll), Math.cos(halfRoll)]
  return normalizeQuaternion(multiplyQuaternions(multiplyQuaternions(yawQ, pitchQ), rollQ))
}

export function computeNavballFrame({
  relativePosition,
  relativeVelocity,
}: {
  relativePosition: Vec3
  relativeVelocity: Vec3
}): NavballFrame {
  const radialOut = normalize(relativePosition, [0, 1, 0])
  const prograde = normalize(relativeVelocity, [0, 0, 1])
  const normal = normalize(cross(relativePosition, relativeVelocity), [1, 0, 0])

  return {
    prograde,
    retrograde: scale(prograde, -1),
    radialOut,
    radialIn: scale(radialOut, -1),
    normal,
    antiNormal: scale(normal, -1),
  }
}

export function computeNavballCompassFrame({
  relativePosition,
  parentRotationAxis,
}: {
  relativePosition: Vec3
  parentRotationAxis: Vec3
}): NavballCompassFrame | null {
  // Single source of truth for the surface frame (also drives the vehicle's
  // default orientation in the worker).
  const frame = surfaceFrame(relativePosition, parentRotationAxis)
  if (!frame) return null
  const { north, east } = frame

  return {
    north,
    east,
    south: scale(north, -1),
    west: scale(east, -1),
  }
}

/** Below this speed, prograde/retrograde have no meaningful direction — hide them. */
export const PROGRADE_MARKER_MIN_SPEED = 0.01

export function computeNavballMarkers({
  orientation,
  relativePosition,
  relativeVelocity,
  radius,
  maneuverDirection,
  orbitNormal,
}: {
  orientation: Quaternion
  relativePosition: Vec3
  relativeVelocity: Vec3
  radius: number
  maneuverDirection?: Vec3
  orbitNormal?: Vec3
}): NavballMarkers {
  const frame = computeNavballFrame({ relativePosition, relativeVelocity })
  const speed = Math.hypot(relativeVelocity[0], relativeVelocity[1], relativeVelocity[2])
  const prograde = speed >= PROGRADE_MARKER_MIN_SPEED
    ? projectNavballVector(worldToCraft(frame.prograde, orientation), radius)
    : { x: 0, y: 0, visible: false }
  const retrograde = speed >= PROGRADE_MARKER_MIN_SPEED
    ? projectNavballVector(worldToCraft(frame.retrograde, orientation), radius)
    : { x: 0, y: 0, visible: false }
  // Prefer the true orbital normal (inertial, from the reference frame) so the
  // normal markers stay correct near the surface, where the surface-relative
  // velocity ≈ 0 makes cross(r, v) degenerate to an arbitrary axis.
  const normalVec = orbitNormal ?? frame.normal
  const markers: NavballMarkers = {
    prograde,
    retrograde,
    radialOut: projectNavballVector(worldToCraft(frame.radialOut, orientation), radius),
    radialIn: projectNavballVector(worldToCraft(frame.radialIn, orientation), radius),
    normal: projectNavballVector(worldToCraft(normalVec, orientation), radius),
    antiNormal: projectNavballVector(worldToCraft(scale(normalVec, -1), orientation), radius),
  }
  if (maneuverDirection) {
    markers.maneuver = projectNavballVector(worldToCraft(maneuverDirection, orientation), radius)
  }
  return markers
}

export function computeNavballState({
  orientation,
  relativePosition,
  relativeVelocity,
  parentRotationAxis,
  radius,
  maneuverDirection,
  orbitNormal,
}: {
  orientation: Quaternion
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentRotationAxis?: Vec3
  radius: number
  maneuverDirection?: Vec3
  orbitNormal?: Vec3
}): NavballState {
  const compassFrame = parentRotationAxis
    ? computeNavballCompassFrame({ relativePosition, parentRotationAxis })
    : null
  const radialOut = normalize(relativePosition, [0, 1, 0])
  const horizontals = compassFrame
    ? [compassFrame.north, compassFrame.east]
    : fallbackMeridianAxes(radialOut)

  return {
    markers: computeNavballMarkers({
      orientation,
      relativePosition,
      relativeVelocity,
      radius,
      maneuverDirection,
      orbitNormal,
    }),
    compass: compassFrame
      ? {
          north: projectNavballVector(worldToCraft(compassFrame.north, orientation), radius),
          east: projectNavballVector(worldToCraft(compassFrame.east, orientation), radius),
          south: projectNavballVector(worldToCraft(compassFrame.south, orientation), radius),
          west: projectNavballVector(worldToCraft(compassFrame.west, orientation), radius),
        }
      : null,
    horizon: computeHorizon({ orientation, radialOut, radius }),
    meridians: horizontals.map((horizontal) =>
      computeMeridian({ orientation, radialOut, horizontal, radius }),
    ),
    sky: computeHorizonFill({ orientation, radialOut, radius }),
  }
}

export function projectNavballVector(vector: Vec3, radius: number): ProjectedNavballPoint {
  const v = normalize(vector, [0, 0, 1])
  return {
    x: cleanNumber(v[0] * radius),
    y: cleanNumber(-v[1] * radius),
    visible: v[2] >= 0,
  }
}

export function shouldRenderNavballMarker(point: ProjectedNavballPoint): boolean {
  return point.visible
}

export function visibleNavballSegments(points: ProjectedNavballPoint[]): ProjectedNavballPoint[][] {
  const segments: ProjectedNavballPoint[][] = []
  let current: ProjectedNavballPoint[] = []

  for (const point of points) {
    if (point.visible) {
      current.push(point)
      continue
    }
    if (current.length > 0) {
      segments.push(current)
      current = []
    }
  }

  if (current.length > 0) segments.push(current)
  return segments
}

function computeHorizon({
  orientation,
  radialOut,
  radius,
}: {
  orientation: Quaternion
  radialOut: Vec3
  radius: number
}): ProjectedNavballPoint[] {
  const up = worldToCraft(radialOut, orientation)
  const basisA = normalize(cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]), [1, 0, 0])
  const basisB = normalize(cross(up, basisA), [0, 0, 1])
  const points: ProjectedNavballPoint[] = []

  for (let i = 0; i <= 64; i++) {
    const angle = (Math.PI * 2 * i) / 64
    const point = add(scale(basisA, Math.cos(angle)), scale(basisB, Math.sin(angle)))
    points.push(projectNavballVector(point, radius))
  }

  return points
}

/**
 * A meridian great circle: passes through the up/down poles (radialOut/In) and
 * a horizontal axis (north or east). Traced in craft frame so it rotates with
 * the sphere as the craft reorients.
 */
function computeMeridian({
  orientation,
  radialOut,
  horizontal,
  radius,
}: {
  orientation: Quaternion
  radialOut: Vec3
  horizontal: Vec3
  radius: number
}): ProjectedNavballPoint[] {
  const up = worldToCraft(radialOut, orientation)
  const side = worldToCraft(horizontal, orientation)
  const points: ProjectedNavballPoint[] = []
  for (let i = 0; i <= 64; i++) {
    const angle = (Math.PI * 2 * i) / 64
    const point = add(scale(up, Math.cos(angle)), scale(side, Math.sin(angle)))
    points.push(projectNavballVector(point, radius))
  }
  return points
}

/** Two world-frame axes perpendicular to radialOut, for meridians when there's
 * no compass frame (no parent rotation axis). */
function fallbackMeridianAxes(radialOut: Vec3): [Vec3, Vec3] {
  const a = normalize(cross(radialOut, Math.abs(radialOut[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]), [1, 0, 0])
  const b = normalize(cross(radialOut, a), [0, 0, 1])
  return [a, b]
}

export interface ScreenPoint {
  x: number
  y: number
}

/**
 * The "sky" hemisphere polygon (the half toward radialOut), in screen offsets
 * from the navball center. Bounded by the visible horizon great-circle arc and
 * the sky-side silhouette arc, so it follows the *curved* horizon like a real
 * attitude indicator. The rest of the disc is "ground". Empty = all ground;
 * a full circle = all sky.
 */
export function computeHorizonFill({
  orientation,
  radialOut,
  radius,
}: {
  orientation: Quaternion
  radialOut: Vec3
  radius: number
}): ScreenPoint[] {
  const up = worldToCraft(radialOut, orientation)
  const segments = 96
  const basisA = normalize(cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]), [1, 0, 0])
  const basisB = normalize(cross(up, basisA), [0, 0, 1])

  // Horizon great-circle samples: screen point + whether it faces the viewer.
  const samples = Array.from({ length: segments }, (_unused, i) => {
    const angle = (2 * Math.PI * i) / segments
    const point = add(scale(basisA, Math.cos(angle)), scale(basisB, Math.sin(angle)))
    return { x: point[0] * radius, y: -point[1] * radius, front: point[2] >= 0 }
  })
  const frontCount = samples.filter((s) => s.front).length
  if (frontCount === 0) return up[2] > 0 ? circlePoints(radius, segments) : []
  if (frontCount === segments) return up[2] > 0 ? circlePoints(radius, segments) : []

  // Rotate to the back→front transition so the visible arc is contiguous.
  let start = 0
  for (let i = 0; i < segments; i++) {
    if (samples[i].front && !samples[(i - 1 + segments) % segments].front) {
      start = i
      break
    }
  }
  const polygon: ScreenPoint[] = []
  for (let k = 0; k < segments; k++) {
    const sample = samples[(start + k) % segments]
    if (!sample.front) break
    polygon.push({ x: sample.x, y: sample.y })
  }

  // Close along the silhouette from B back to A on the sky side (dot(·, up) > 0).
  const a = polygon[0]
  const b = polygon[polygon.length - 1]
  const angleA = Math.atan2(a.y, a.x)
  const angleB = Math.atan2(b.y, b.x)
  const skyDot = (angle: number) => Math.cos(angle) * up[0] - Math.sin(angle) * up[1]
  const direction = skyDot(angleB + 0.02) >= skyDot(angleB - 0.02) ? 1 : -1
  let span = direction * (angleA - angleB)
  span = ((span % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const edgeSteps = 48
  for (let k = 1; k <= edgeSteps; k++) {
    const angle = angleB + direction * span * (k / edgeSteps)
    polygon.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
  }
  return polygon
}

function circlePoints(radius: number, count: number): ScreenPoint[] {
  return Array.from({ length: count }, (_unused, i) => {
    const angle = (2 * Math.PI * i) / count
    return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) }
  })
}

function worldToCraft(vector: Vec3, orientation: Quaternion): Vec3 {
  const inverse: Quaternion = [-orientation[0], -orientation[1], -orientation[2], orientation[3]]
  return rotateVectorByQuaternion(vector, inverse)
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
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

function normalizeQuaternion(q: Quaternion): Quaternion {
  const magnitude = Math.hypot(q[0], q[1], q[2], q[3])
  if (magnitude <= 0 || !Number.isFinite(magnitude)) return [0, 0, 0, 1]
  return [
    cleanNumber(q[0] / magnitude),
    cleanNumber(q[1] / magnitude),
    cleanNumber(q[2] / magnitude),
    cleanNumber(q[3] / magnitude),
  ]
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2])
  if (magnitude <= 0 || !Number.isFinite(magnitude)) return fallback
  return [
    cleanNumber(vector[0] / magnitude),
    cleanNumber(vector[1] / magnitude),
    cleanNumber(vector[2] / magnitude),
  ]
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return [
    cleanNumber(vector[0] * scalar),
    cleanNumber(vector[1] * scalar),
    cleanNumber(vector[2] * scalar),
  ]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function cleanNumber(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}
