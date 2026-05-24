import { sampleOrbitAtTrueAnomalies, stateToElements } from './kepler'

export type VehicleOrbitPredictionStatus =
  | 'ok'
  | 'escape'
  | 'encounter'
  | 'strong-perturbation'
  | 'invalid'

export interface PredictionBodyState {
  id: string
  gm: number
  radius: number
  soiRadius?: number
  position: [number, number, number]
  velocity: [number, number, number]
}

export interface VehicleStateVector {
  position: [number, number, number]
  velocity: [number, number, number]
}

export interface VehicleOrbitPredictionOptions {
  vehicle: VehicleStateVector
  parent: PredictionBodyState
  bodies: PredictionBodyState[]
  segments?: number
  perturbationRatioThreshold?: number
}

export interface VehicleOrbitPrediction {
  status: VehicleOrbitPredictionStatus
  parentId: string
  points: [number, number, number][]
  period: number | null
  warnings: string[]
  encounterBodyId?: string
  perturbingBodyId?: string
}

const DEFAULT_SEGMENTS = 192
const DEFAULT_FOCUS_HALF_ANGLE = Math.PI / 18
const DEFAULT_FOCUS_SEGMENTS = 96
const APSIS_FOCUS_ECCENTRICITY = 0.05
const APSIS_FOCUS_SEGMENTS = 96
const DEFAULT_PERTURBATION_RATIO_THRESHOLD = 0.02

export function predictVehicleOrbit({
  vehicle,
  parent,
  bodies,
  segments = DEFAULT_SEGMENTS,
  perturbationRatioThreshold = DEFAULT_PERTURBATION_RATIO_THRESHOLD,
}: VehicleOrbitPredictionOptions): VehicleOrbitPrediction {
  const relPos = subtract(vehicle.position, parent.position)
  const relVel = subtract(vehicle.velocity, parent.velocity)
  const warnings: string[] = []
  if (mag(relVel) < 1e-6 || mag(cross(relPos, relVel)) < 1e-6) {
    return {
      status: 'invalid',
      parentId: parent.id,
      points: [],
      period: null,
      warnings: ['degenerate-state'],
    }
  }

  const elements = stateToElements(relPos, relVel, parent.gm)
  if (!Number.isFinite(elements.a) || elements.a <= 0 || elements.e >= 1) {
    const points = sampleOpenEscapeArc(elements, parent, mag(relPos), segments)
    return {
      status: 'escape',
      parentId: parent.id,
      points,
      period: null,
      warnings: ['hyperbolic-or-parabolic'],
    }
  }

  const apoapsis = elements.a * (1 + elements.e)
  if (parent.soiRadius !== undefined && apoapsis > parent.soiRadius) {
    warnings.push('apoapsis-exceeds-parent-soi')
  }

  const anomalies = visibleFocusedCycleAnomalies(
    elements,
    parent.radius,
    elements.ta,
    segments,
    DEFAULT_FOCUS_HALF_ANGLE,
    DEFAULT_FOCUS_SEGMENTS,
    elements.e,
  )
  const points = sampleOrbitAtTrueAnomalies(elements, anomalies)
  if (points.length <= 2) {
    return {
      status: 'invalid',
      parentId: parent.id,
      points: [],
      period: null,
      warnings: ['invalid-orbit'],
    }
  }

  const encounterBodyId = firstEncounter(points, parent, bodies)
  if (encounterBodyId) warnings.push(`encounter:${encounterBodyId}`)

  const perturbingBodyId = strongestPerturbation(
    points,
    parent,
    bodies,
    perturbationRatioThreshold,
  )
  if (perturbingBodyId) warnings.push(`strong-perturbation:${perturbingBodyId}`)

  return {
    status: statusForWarnings(warnings),
    parentId: parent.id,
    points,
    period: orbitalPeriod(elements.a, parent.gm),
    warnings,
    encounterBodyId,
    perturbingBodyId,
  }
}

function statusForWarnings(warnings: string[]): VehicleOrbitPredictionStatus {
  if (warnings.includes('apoapsis-exceeds-parent-soi')) return 'escape'
  if (warnings.some((warning) => warning.startsWith('encounter:'))) return 'encounter'
  if (warnings.some((warning) => warning.startsWith('strong-perturbation:'))) {
    return 'strong-perturbation'
  }
  return 'ok'
}

function oneCycleAnomalies(segments: number): number[] {
  const anomalies: number[] = []
  for (let i = 0; i <= segments; i++) {
    anomalies.push((i / segments) * Math.PI * 2)
  }
  return anomalies
}

function focusedCycleAnomalies(
  currentAnomaly: number,
  baseSegments: number,
  focusHalfAngle: number,
  focusSegments: number,
  eccentricity: number,
): number[] {
  const twoPi = Math.PI * 2
  const anomalies = new Map<number, number>()
  const add = (theta: number) => {
    const normalized = ((theta % twoPi) + twoPi) % twoPi
    anomalies.set(Math.round(normalized * 1e9), normalized)
  }

  for (const anomaly of oneCycleAnomalies(baseSegments)) add(anomaly)
  for (let i = 0; i <= focusSegments; i++) {
    add(currentAnomaly - focusHalfAngle + (i / focusSegments) * focusHalfAngle * 2)
  }
  if (eccentricity >= APSIS_FOCUS_ECCENTRICITY) {
    for (let i = 0; i <= APSIS_FOCUS_SEGMENTS; i++) {
      const offset = -focusHalfAngle + (i / APSIS_FOCUS_SEGMENTS) * focusHalfAngle * 2
      add(offset)
      add(Math.PI + offset)
    }
  }

  const sorted = Array.from(anomalies.values()).sort((a, b) => a - b)
  if (sorted[sorted.length - 1] !== twoPi) sorted.push(twoPi)
  return sorted
}

function visibleFocusedCycleAnomalies(
  elements: ReturnType<typeof stateToElements>,
  parentRadius: number,
  currentAnomaly: number,
  baseSegments: number,
  focusHalfAngle: number,
  focusSegments: number,
  eccentricity: number,
): number[] {
  const periapsis = elements.a * (1 - elements.e)
  if (periapsis >= parentRadius || elements.e <= 1e-10) {
    return focusedCycleAnomalies(currentAnomaly, baseSegments, focusHalfAngle, focusSegments, eccentricity)
  }

  const apoapsis = elements.a * (1 + elements.e)
  if (apoapsis <= parentRadius) return []

  const p = elements.a * (1 - elements.e * elements.e)
  const threshold = (p / parentRadius - 1) / elements.e
  if (threshold >= 1) {
    return focusedCycleAnomalies(currentAnomaly, baseSegments, focusHalfAngle, focusSegments, eccentricity)
  }
  if (threshold <= -1) return []

  const start = Math.acos(threshold)
  const end = Math.PI * 2 - start
  const anomalies = new Map<number, number>()
  const add = (theta: number) => {
    if (theta < start || theta > end) return
    anomalies.set(Math.round(theta * 1e9), theta)
  }

  for (let i = 0; i <= baseSegments; i++) {
    add(start + ((end - start) * i) / baseSegments)
  }
  addFocusedWindow(anomalies, currentAnomaly, focusHalfAngle, focusSegments, start, end)
  addFocusedWindow(anomalies, Math.PI, focusHalfAngle, APSIS_FOCUS_SEGMENTS, start, end)

  return Array.from(anomalies.values()).sort((a, b) => a - b)
}

function addFocusedWindow(
  anomalies: Map<number, number>,
  center: number,
  halfAngle: number,
  segments: number,
  start: number,
  end: number,
): void {
  for (let i = 0; i <= segments; i++) {
    const theta = center - halfAngle + (i / segments) * halfAngle * 2
    if (theta >= start && theta <= end) anomalies.set(Math.round(theta * 1e9), theta)
  }
}

function sampleOpenEscapeArc(
  elements: ReturnType<typeof stateToElements>,
  parent: PredictionBodyState,
  currentRadius: number,
  segments: number,
): [number, number, number][] {
  const distanceLimit = parent.soiRadius ?? currentRadius * 50
  if (elements.e <= 1 || !Number.isFinite(elements.e)) {
    return sampleRayEscapeArc(elements, currentRadius, distanceLimit, segments)
  }

  const p = elements.a * (1 - elements.e * elements.e)
  if (!Number.isFinite(p) || p <= 0) {
    return sampleRayEscapeArc(elements, currentRadius, distanceLimit, segments)
  }

  const asymptote = Math.acos(-1 / elements.e)
  const maxTheta = asymptote - 1e-4
  const startTheta = Math.min(elements.ta, maxTheta)
  const points: [number, number, number][] = []

  for (let i = 0; i <= segments; i++) {
    const theta = startTheta + ((maxTheta - startTheta) * i) / segments
    const radius = p / (1 + elements.e * Math.cos(theta))
    if (!Number.isFinite(radius) || radius > distanceLimit) {
      points.push(pointAtTrueAnomaly(elements, theta, distanceLimit))
      break
    }
    points.push(pointAtTrueAnomaly(elements, theta, radius))
  }

  return points.length > 1
    ? points
    : sampleRayEscapeArc(elements, currentRadius, distanceLimit, segments)
}

function sampleRayEscapeArc(
  elements: ReturnType<typeof stateToElements>,
  currentRadius: number,
  distanceLimit: number,
  segments: number,
): [number, number, number][] {
  const points: [number, number, number][] = []
  const step = Math.max(distanceLimit - currentRadius, 0) / segments
  const direction = outboundDirection(elements)

  for (let i = 0; i <= segments; i++) {
    const distance = Math.min(currentRadius + step * i, distanceLimit)
    points.push([
      direction[0] * distance,
      direction[1] * distance,
      direction[2] * distance,
    ])
  }

  return points
}

function pointAtTrueAnomaly(
  elements: ReturnType<typeof stateToElements>,
  theta: number,
  radius: number,
): [number, number, number] {
  const x = Math.cos(theta) * radius
  const y = Math.sin(theta) * radius
  return [
    elements.pHat[0] * x + elements.qHat[0] * y,
    elements.pHat[1] * x + elements.qHat[1] * y,
    elements.pHat[2] * x + elements.qHat[2] * y,
  ]
}

function outboundDirection(
  elements: ReturnType<typeof stateToElements>,
): [number, number, number] {
  const theta = elements.ta
  const x = Math.cos(theta)
  const y = Math.sin(theta)
  const direction: [number, number, number] = [
    elements.pHat[0] * x + elements.qHat[0] * y,
    elements.pHat[1] * x + elements.qHat[1] * y,
    elements.pHat[2] * x + elements.qHat[2] * y,
  ]
  const m = mag(direction)
  return m > 0 ? [direction[0] / m, direction[1] / m, direction[2] / m] : [1, 0, 0]
}

function firstEncounter(
  points: [number, number, number][],
  parent: PredictionBodyState,
  bodies: PredictionBodyState[],
): string | undefined {
  for (const body of bodies) {
    if (body.id === parent.id) continue
    const influenceRadius = body.soiRadius && body.soiRadius > 0
      ? body.soiRadius
      : body.radius * 3
    const bodyRelPos = subtract(body.position, parent.position)
    if (points.some((point) => distance(point, bodyRelPos) <= influenceRadius)) {
      return body.id
    }
  }
  return undefined
}

function strongestPerturbation(
  points: [number, number, number][],
  parent: PredictionBodyState,
  bodies: PredictionBodyState[],
  threshold: number,
): string | undefined {
  for (const point of points) {
    const parentGravity = parent.gm / Math.max(mag(point) ** 2, 1)
    for (const body of bodies) {
      if (body.id === parent.id) continue
      const bodyRelPos = subtract(body.position, parent.position)
      const bodyDistance = Math.max(distance(point, bodyRelPos), 1)
      const perturbingGravity = body.gm / (bodyDistance * bodyDistance)
      if (perturbingGravity / parentGravity >= threshold) return body.id
    }
  }
  return undefined
}

function orbitalPeriod(semiMajorAxis: number, gm: number): number {
  return Math.PI * 2 * Math.sqrt((semiMajorAxis ** 3) / gm)
}

function subtract(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

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

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function mag(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2])
}
