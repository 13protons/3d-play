import type { VehicleOrbitPredictionStatus } from '../sim/orbital/vehiclePrediction'

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
