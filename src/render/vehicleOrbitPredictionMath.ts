import type { VehicleOrbitPredictionStatus } from '../sim/orbital/vehiclePrediction'
import type { FlightReferenceMode, Vec3 } from '../sim/vehicle/referenceFrame'

const SURFACE_PREDICTION_MIN_SPEED_METERS_PER_SECOND = 1

interface VehicleOrbitLineStyle {
  color: string
  lineWidth: number
  opacity: number
}

export function shouldRenderVehicleOrbitPrediction(
  activeView: 'orbital' | 'vehicle',
  pointCount: number,
): boolean {
  return activeView === 'orbital' && pointCount > 2
}

export function shouldRecomputeVehicleOrbitPrediction(
  lastComputedSimTime: number | null,
  currentSimTime: number,
  intervalSeconds: number,
  accelerating: boolean,
): boolean {
  return (
    accelerating ||
    lastComputedSimTime === null ||
    currentSimTime - lastComputedSimTime >= intervalSeconds
  )
}

export function shouldPredictVehicleOrbit({
  mode,
  relativeVelocity,
}: {
  mode: FlightReferenceMode
  relativeVelocity: Vec3
}): boolean {
  return mode === 'orbital' || magnitude(relativeVelocity) >= SURFACE_PREDICTION_MIN_SPEED_METERS_PER_SECOND
}

export function vehicleOrbitLineStyle(
  status: VehicleOrbitPredictionStatus,
): VehicleOrbitLineStyle {
  if (status === 'escape') return { color: '#f0b028', lineWidth: 3, opacity: 1 }
  if (status === 'encounter') return { color: '#ff5a4f', lineWidth: 3, opacity: 1 }
  if (status === 'strong-perturbation') {
    return { color: '#d6a64a', lineWidth: 3, opacity: 1 }
  }
  if (status === 'invalid') return { color: '#666666', lineWidth: 2, opacity: 1 }
  return { color: '#28f0a0', lineWidth: 3, opacity: 1 }
}

export function predictionStateForReferenceFrame({
  mode,
  vehiclePosition,
  vehicleVelocity,
  parentPosition,
  parentVelocity,
  parentAngularVelocity,
  parentRotationAxis,
}: {
  mode: FlightReferenceMode
  vehiclePosition: Vec3
  vehicleVelocity: Vec3
  parentPosition: Vec3
  parentVelocity: Vec3
  parentAngularVelocity: number
  parentRotationAxis: Vec3
}) {
  if (mode === 'orbital') {
    return { vehicle: { position: vehiclePosition, velocity: vehicleVelocity } }
  }

  const relativePosition = subtract(vehiclePosition, parentPosition)
  const relativeVelocity = subtract(vehicleVelocity, parentVelocity)
  const surfaceVelocity = subtract(
    relativeVelocity,
    cross(scale(parentRotationAxis, parentAngularVelocity), relativePosition),
  )
  return {
    vehicle: {
      position: vehiclePosition,
      velocity: add(parentVelocity, surfaceVelocity),
    },
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [clean(a[0] - b[0]), clean(a[1] - b[1]), clean(a[2] - b[2])]
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
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

function clean(value: number) {
  return Math.abs(value) < 1e-12 ? 0 : value
}
