import { describe, expect, it } from 'vitest'
import {
  isVehicleActivelyAccelerating,
  predictionStateForReferenceFrame,
  shouldPredictVehicleOrbit,
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

  it('recomputes when simulated time rewinds', () => {
    expect(shouldRecomputeVehicleOrbitPrediction(100, 99, 5, false)).toBe(true)
  })

  it('recomputes when prediction inputs are replaced while coasting', () => {
    const oldCurve = { id: 'vehicle' }
    const newCurve = { id: 'vehicle' }

    expect(shouldRecomputeVehicleOrbitPrediction(100, 101, 5, false, [oldCurve], [oldCurve])).toBe(false)
    expect(shouldRecomputeVehicleOrbitPrediction(100, 101, 5, false, [oldCurve], [newCurve])).toBe(true)
  })
})

describe('isVehicleActivelyAccelerating', () => {
  it('does not treat coasting gravity-driven velocity changes as active acceleration', () => {
    expect(isVehicleActivelyAccelerating({
      throttle: 0,
      orientation: [0, 0, 0, 1],
      angularVelocity: [0, 0, 0],
      attitudeMode: 'manual',
      surfaceState: 'flying',
      currentThrust: 0,
    })).toBe(false)
  })

  it('forces immediate recompute while thrust is being applied', () => {
    expect(isVehicleActivelyAccelerating({
      throttle: 0.5,
      orientation: [0, 0, 0, 1],
      angularVelocity: [0, 0, 0],
      attitudeMode: 'manual',
      surfaceState: 'flying',
      currentThrust: 100,
    })).toBe(true)
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

describe('predictionStateForReferenceFrame', () => {
  it('removes parent surface rotation from the vehicle velocity in surface mode', () => {
    const state = predictionStateForReferenceFrame({
      mode: 'surface',
      vehiclePosition: [10, 0, 0],
      vehicleVelocity: [0, 0, -2],
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 0],
      parentAngularVelocity: 0.2,
      parentRotationAxis: [0, 1, 0],
    })

    expect(state.vehicle.velocity).toEqual([0, 0, 0])
  })

  it('keeps inertial velocity in orbital mode so handoff uses the real orbit state', () => {
    const state = predictionStateForReferenceFrame({
      mode: 'orbital',
      vehiclePosition: [10, 0, 0],
      vehicleVelocity: [0, 0, -2],
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 0],
      parentAngularVelocity: 0.2,
      parentRotationAxis: [0, 1, 0],
    })

    expect(state.vehicle.velocity).toEqual([0, 0, -2])
  })
})

describe('shouldPredictVehicleOrbit', () => {
  it('suppresses surface-mode predictions until there is meaningful surface-relative motion', () => {
    expect(shouldPredictVehicleOrbit({ mode: 'surface', relativeVelocity: [0, 0, 0] })).toBe(false)
    expect(shouldPredictVehicleOrbit({ mode: 'surface', relativeVelocity: [0.2, 0, 0] })).toBe(false)
    expect(shouldPredictVehicleOrbit({ mode: 'surface', relativeVelocity: [2, 0, 0] })).toBe(true)
  })

  it('keeps orbital-mode predictions enabled for inertial states', () => {
    expect(shouldPredictVehicleOrbit({ mode: 'orbital', relativeVelocity: [0, 0, 0] })).toBe(true)
  })
})
