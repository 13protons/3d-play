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

export interface ProjectedNavballPoint {
  x: number
  y: number
  visible: boolean
}

export type NavballMarkers = Record<keyof NavballFrame, ProjectedNavballPoint>

export interface NavballState {
  markers: NavballMarkers
  horizon: ProjectedNavballPoint[]
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

export function computeNavballMarkers({
  orientation,
  relativePosition,
  relativeVelocity,
  radius,
}: {
  orientation: Quaternion
  relativePosition: Vec3
  relativeVelocity: Vec3
  radius: number
}): NavballMarkers {
  const frame = computeNavballFrame({ relativePosition, relativeVelocity })
  return {
    prograde: projectNavballVector(worldToCraft(frame.prograde, orientation), radius),
    retrograde: projectNavballVector(worldToCraft(frame.retrograde, orientation), radius),
    radialOut: projectNavballVector(worldToCraft(frame.radialOut, orientation), radius),
    radialIn: projectNavballVector(worldToCraft(frame.radialIn, orientation), radius),
    normal: projectNavballVector(worldToCraft(frame.normal, orientation), radius),
    antiNormal: projectNavballVector(worldToCraft(frame.antiNormal, orientation), radius),
  }
}

export function computeNavballState({
  orientation,
  relativePosition,
  relativeVelocity,
  radius,
}: {
  orientation: Quaternion
  relativePosition: Vec3
  relativeVelocity: Vec3
  radius: number
}): NavballState {
  return {
    markers: computeNavballMarkers({ orientation, relativePosition, relativeVelocity, radius }),
    horizon: computeHorizon({ orientation, radialOut: normalize(relativePosition, [0, 1, 0]), radius }),
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
