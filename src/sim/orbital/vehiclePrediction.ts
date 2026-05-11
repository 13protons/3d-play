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

  const elements = stateToElements(relPos, relVel, parent.gm)
  if (!Number.isFinite(elements.a) || elements.a <= 0 || elements.e >= 1) {
    return {
      status: 'escape',
      parentId: parent.id,
      points: [],
      period: null,
      warnings: ['hyperbolic-or-parabolic'],
    }
  }

  const apoapsis = elements.a * (1 + elements.e)
  if (parent.soiRadius !== undefined && apoapsis > parent.soiRadius) {
    warnings.push('apoapsis-exceeds-parent-soi')
  }

  const anomalies = oneCycleAnomalies(segments)
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

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function mag(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2])
}
