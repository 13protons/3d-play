import { describe, expect, it } from 'vitest'
import {
  validateBodyDefinition,
  validateScenarioAssets,
  validateVehicleDefinition,
} from '../scenarioValidation'

describe('validateScenarioAssets', () => {
  it('accepts the inner solar system scenario and body definitions', () => {
    const result = validateScenarioAssets('inner-solar-system')

    expect(result.missingBodyDefinitions).toEqual([])
    expect(result.invalidBodyDefinitions).toEqual([])
    expect(result.invalidVehicles).toEqual([])
    expect(result.vehicleIdsWithAero).toEqual(['vehicle-1'])
    expect(result.vehicleIdsWithEngine).toEqual(['vehicle-1'])
    expect(result.vehicleIdsWithAttitude).toEqual(['vehicle-1'])
    expect(result.bodyIds).toEqual([
      'sun',
      'mercury',
      'venus',
      'earth',
      'moon',
      'mars',
      'phobos',
      'deimos',
    ])
  })

  it('accepts the full solar system scenario and body definitions', () => {
    const result = validateScenarioAssets('full-solar-system')

    expect(result.missingBodyDefinitions).toEqual([])
    expect(result.invalidBodyDefinitions).toEqual([])
    expect(result.invalidVehicles).toEqual([])
    expect(result.vehicleIdsWithAero).toEqual(['vehicle-1'])
    expect(result.vehicleIdsWithEngine).toEqual(['vehicle-1'])
    expect(result.vehicleIdsWithAttitude).toEqual(['vehicle-1'])
    expect(result.bodyIds).toEqual([
      'sun',
      'mercury',
      'venus',
      'earth',
      'moon',
      'mars',
      'phobos',
      'deimos',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ])
  })

  it('accepts inline exponential atmosphere on a body', () => {
    expect(() => validateBodyDefinition({
      id: 'earth',
      atmosphere: {
        loadRadiusMultiplier: 1.25,
        model: 'exponential',
        surfaceDensity: 1.225,
        scaleHeight: 8500,
        maxAltitude: 120000,
      },
    })).not.toThrow()
  })

  it('rejects invalid atmosphere fields', () => {
    expect(() => validateBodyDefinition({
      id: 'bad',
      atmosphere: {
        loadRadiusMultiplier: 0.5,
        model: 'exponential',
        surfaceDensity: 1,
        scaleHeight: 8500,
        maxAltitude: 100000,
      },
    })).toThrow('atmosphere.loadRadiusMultiplier')
  })

  it('accepts vehicle resources and simple drag aero', () => {
    expect(() => validateVehicleDefinition({
      id: 'vehicle-1',
      resources: { dryMass: 1000, fuelMass: 0 },
      engine: { maxThrust: 300_000 },
      attitude: {
        momentOfInertia: [12_000, 12_000, 8_000],
        reactionWheelTorque: [400_000, 400_000, 250_000],
      },
      aero: {
        model: 'simple-drag',
        dragCoefficient: 2.2,
        referenceArea: 10,
        referenceLength: 2,
        centerOfPressureBody: [0, 0, 0],
      },
    })).not.toThrow()
  })

  it('rejects invalid vehicle resources and aero', () => {
    expect(() => validateVehicleDefinition({
      id: 'vehicle-1',
      resources: { dryMass: 0, fuelMass: 0 },
      aero: { model: 'simple-drag', dragCoefficient: 2.2, referenceArea: 10 },
    })).toThrow('resources.dryMass')

    expect(() => validateVehicleDefinition({
      id: 'vehicle-1',
      resources: { dryMass: 1000, fuelMass: 0 },
      aero: { model: 'unknown', dragCoefficient: 2.2, referenceArea: 10 },
    })).toThrow('aero.model')

    expect(() => validateVehicleDefinition({
      id: 'vehicle-1',
      engine: { maxThrust: 0 },
    })).toThrow('engine.maxThrust')

    expect(() => validateVehicleDefinition({
      id: 'vehicle-1',
      attitude: {
        momentOfInertia: [12_000, 0, 8_000],
        reactionWheelTorque: [400_000, 400_000, 250_000],
      },
    })).toThrow('attitude.momentOfInertia')

    expect(() => validateVehicleDefinition({
      id: 'vehicle-1',
      attitude: {
        momentOfInertia: [12_000, 12_000, 8_000],
        reactionWheelTorque: [400_000, -1, 250_000],
      },
    })).toThrow('attitude.reactionWheelTorque')
  })
})
