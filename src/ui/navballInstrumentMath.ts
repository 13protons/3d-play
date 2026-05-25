interface ArcProgressInput {
  value: number
  radius: number
  cx: number
  cy: number
  startDegrees: number
  endDegrees: number
  mirror?: boolean
}

interface ForceLoadInput {
  currentThrust?: number
  aeroForceWorld?: [number, number, number]
  mass?: number
  maxG?: number
}

const EARTH_GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665
const DEFAULT_FORCE_LOAD_MAX_G = 10

interface Point {
  x: number
  y: number
}

export function computeArcProgressPath({
  value,
  radius,
  cx,
  cy,
  startDegrees,
  endDegrees,
  mirror = false,
}: ArcProgressInput) {
  const clampedValue = Math.max(0, Math.min(1, value))
  const sweepFlag = mirror ? 1 : 0
  const range = startDegrees - endDegrees
  const progressDegrees = startDegrees - clampedValue * range
  const start = pointOnArc({ degrees: startDegrees, radius, cx, cy, mirror })
  const end = pointOnArc({ degrees: endDegrees, radius, cx, cy, mirror })
  const progress = pointOnArc({ degrees: progressDegrees, radius, cx, cy, mirror })

  return {
    trackPath: arcPath({ start, end, radius, sweepFlag }),
    progressPath: arcPath({ start, end: progress, radius, sweepFlag }),
  }
}

export function computeForceLoadRatio({
  currentThrust = 0,
  aeroForceWorld,
  mass,
  maxG = DEFAULT_FORCE_LOAD_MAX_G,
}: ForceLoadInput) {
  if (!mass || mass <= 0 || maxG <= 0) return 0

  const aeroForce = aeroForceWorld ? vectorMagnitude(aeroForceWorld) : 0
  const loadG = (Math.max(0, currentThrust) + aeroForce) / mass / EARTH_GRAVITY_METERS_PER_SECOND_SQUARED
  return Math.max(0, Math.min(1, loadG / maxG))
}

function pointOnArc({
  degrees,
  radius,
  cx,
  cy,
  mirror,
}: {
  degrees: number
  radius: number
  cx: number
  cy: number
  mirror: boolean
}): Point {
  const theta = degreesToRadians(degrees - 90)
  const xOffset = radius * Math.cos(theta)
  return {
    x: mirror ? cx - xOffset : cx + xOffset,
    y: cy + radius * Math.sin(theta),
  }
}

function arcPath({ start, end, radius, sweepFlag }: { start: Point; end: Point; radius: number; sweepFlag: 0 | 1 }) {
  return `M ${formatCoord(start.x)} ${formatCoord(start.y)} A ${radius} ${radius} 0 0 ${sweepFlag} ${formatCoord(end.x)} ${formatCoord(end.y)}`
}

function degreesToRadians(degrees: number) {
  return degrees * (Math.PI / 180)
}

function vectorMagnitude(vector: [number, number, number]) {
  return Math.hypot(vector[0], vector[1], vector[2])
}

function formatCoord(value: number) {
  return Math.round(value)
}
