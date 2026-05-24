import { describe, expect, it } from 'vitest'
import {
  shouldRenderVehicleOrbitPrediction,
  shouldRecomputeVehicleOrbitPrediction,
  vehicleOrbitLineStyle,
} from '../vehicleOrbitPredictionMath'

describe('shouldRenderVehicleOrbitPrediction', () => {
  it('renders only in orbital view with available prediction points', () => {
    expect(shouldRenderVehicleOrbitPrediction('vehicle', 10)).toBe(false)
    expect(shouldRenderVehicleOrbitPrediction('orbital', 0)).toBe(false)
    expect(shouldRenderVehicleOrbitPrediction('orbital', 3)).toBe(true)
  })
})

describe('shouldRecomputeVehicleOrbitPrediction', () => {
  it('always recomputes while accelerating', () => {
    expect(shouldRecomputeVehicleOrbitPrediction(100, 101, 5, true)).toBe(true)
  })

  it('uses a short simulated interval while coasting', () => {
    expect(shouldRecomputeVehicleOrbitPrediction(null, 100, 5, false)).toBe(true)
    expect(shouldRecomputeVehicleOrbitPrediction(100, 104.9, 5, false)).toBe(false)
    expect(shouldRecomputeVehicleOrbitPrediction(100, 105, 5, false)).toBe(true)
  })
})

describe('vehicleOrbitLineStyle', () => {
  it('uses distinct colors for ok and warning statuses', () => {
    expect(vehicleOrbitLineStyle('ok')).toEqual({ color: '#28f0a0', lineWidth: 3, opacity: 1 })
    expect(vehicleOrbitLineStyle('escape').color).toBe('#f0b028')
    expect(vehicleOrbitLineStyle('encounter').color).toBe('#ff5a4f')
    expect(vehicleOrbitLineStyle('strong-perturbation').color).toBe('#d6a64a')
  })
})
