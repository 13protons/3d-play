interface OrbitLineStyle {
  color: string
  lineWidth: number
  opacity: number
}

const ORBIT_COLORS = new Map([
  ['earth', '#214bb3'],
  ['venus', '#d99a24'],
  ['mars', '#d75a32'],
  ['jupiter', '#c9782e'],
  ['saturn', '#b58a3a'],
  ['uranus', '#49b9c4'],
  ['neptune', '#355fd8'],
])

const DIM_ORBIT_COLORS = new Map([
  ['earth', '#102b6d'],
  ['venus', '#6c4d12'],
  ['mars', '#6b2d19'],
  ['jupiter', '#633c17'],
  ['saturn', '#5a451d'],
  ['uranus', '#245c62'],
  ['neptune', '#1a2f6c'],
])

export function shouldRecomputeOrbitPrediction(
  lastComputedSimTime: number | null,
  currentSimTime: number,
  intervalSeconds: number,
  lastInputs: readonly unknown[] = [],
  currentInputs: readonly unknown[] = lastInputs,
): boolean {
  return (
    lastComputedSimTime === null ||
    !sameInputs(lastInputs, currentInputs) ||
    currentSimTime < lastComputedSimTime ||
    currentSimTime - lastComputedSimTime >= intervalSeconds
  )
}

function sameInputs(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function usesUniformOrbitLineOpacity(): boolean {
  return true
}

export function orbitLineStyleForBody(
  bodyId: string | undefined,
  followTargetId?: string,
): OrbitLineStyle {
  const isFocused = bodyId !== undefined && bodyId === followTargetId
  return {
    color: (isFocused ? ORBIT_COLORS : DIM_ORBIT_COLORS).get(bodyId ?? '') ??
      (isFocused ? '#7f8cff' : '#40466f'),
    lineWidth: isFocused ? 3 : 2,
    opacity: 1,
  }
}

export function predictionTrueAnomalies(
  currentAnomaly: number,
  baseSegments: number,
  focusHalfAngle: number,
  focusSegments: number,
): number[] {
  const twoPi = Math.PI * 2
  const angles = new Map<number, number>()
  const add = (theta: number) => {
    const normalized = ((theta % twoPi) + twoPi) % twoPi
    angles.set(Math.round(normalized * 1e9), normalized)
  }

  for (let i = 0; i < baseSegments; i++) {
    add((i / baseSegments) * twoPi)
  }
  for (let i = 0; i <= focusSegments; i++) {
    const t = i / focusSegments
    add(currentAnomaly - focusHalfAngle + t * focusHalfAngle * 2)
  }

  const sorted = Array.from(angles.values()).sort((a, b) => a - b)
  sorted.push(twoPi)
  return sorted
}

export function splitOrbitLineSegments(
  points: [number, number, number][],
  bodyPosition: [number, number, number],
  exclusionRadius: number,
): [number, number, number][][] {
  const segments: [number, number, number][][] = []
  let current: [number, number, number][] = []
  let previousPoint: [number, number, number] | undefined
  let previousInside = false
  for (const point of points) {
    const inside = distance(point, bodyPosition) <= exclusionRadius
    if (previousPoint) {
      const boundaries = lineSphereBoundaryPoints(previousPoint, point, bodyPosition, exclusionRadius)
      const boundary = boundaries[0]
      if (!previousInside && inside && boundary) {
        current.push(boundary)
      }
      if (previousInside && !inside && boundary) {
        current = [boundary]
      }
      if (!previousInside && !inside && boundaries.length === 2) {
        current.push(boundaries[0])
        if (current.length > 0) segments.push(current)
        current = [boundaries[1]]
      }
    }
    if (inside) {
      if (current.length > 0) {
        segments.push(current)
        current = []
      }
      previousPoint = point
      previousInside = true
      continue
    }
    current.push(point)
    previousPoint = point
    previousInside = false
  }
  if (current.length > 0) segments.push(current)
  return segments
}

function distance(
  point: [number, number, number],
  center: [number, number, number],
): number {
  return Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2])
}

function lineSphereBoundaryPoints(
  from: [number, number, number],
  to: [number, number, number],
  center: [number, number, number],
  radius: number,
): [number, number, number][] {
  const ox = from[0] - center[0]
  const oy = from[1] - center[1]
  const oz = from[2] - center[2]
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  const a = dx * dx + dy * dy + dz * dz
  const b = 2 * (ox * dx + oy * dy + oz * dz)
  const c = ox * ox + oy * oy + oz * oz - radius * radius
  const discriminant = b * b - 4 * a * c
  if (a <= 0 || discriminant < 0) return []
  const sqrt = Math.sqrt(discriminant)
  const t0 = (-b - sqrt) / (2 * a)
  const t1 = (-b + sqrt) / (2 * a)
  return [t0, t1]
    .filter((value, index, values) => value >= 0 && value <= 1 && values.indexOf(value) === index)
    .sort((left, right) => left - right)
    .map((t) => [from[0] + dx * t, from[1] + dy * t, from[2] + dz * t])
}
