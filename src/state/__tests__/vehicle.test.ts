import { describe, expect, it } from 'vitest'
import { useVehicleStore } from '../vehicle'

describe('useVehicleStore', () => {
  it('stores vehicle resources with computed mass', () => {
    useVehicleStore.getState().reset()

    useVehicleStore.getState().setVehicleModel('vehicle-1', {
      resources: { dryMass: 1000, fuelMass: 250 },
      aero: { model: 'simple-drag', dragCoefficient: 2.2, referenceArea: 10 },
    })

    expect(useVehicleStore.getState().models['vehicle-1']).toEqual({
      resources: { dryMass: 1000, fuelMass: 250, mass: 1250 },
      aero: { model: 'simple-drag', dragCoefficient: 2.2, referenceArea: 10 },
    })
  })

  it('clears vehicle models on reset', () => {
    useVehicleStore.getState().setVehicleModel('vehicle-1', {
      resources: { dryMass: 1000, fuelMass: 0 },
      aero: { model: 'simple-drag', dragCoefficient: 2.2, referenceArea: 10 },
    })

    useVehicleStore.getState().reset()

    expect(useVehicleStore.getState().models).toEqual({})
  })

  it('stores resources without aero', () => {
    useVehicleStore.getState().reset()

    useVehicleStore.getState().setVehicleModel('vehicle-1', {
      resources: { dryMass: 1000, fuelMass: 50 },
    })

    expect(useVehicleStore.getState().models['vehicle-1']).toEqual({
      resources: { dryMass: 1000, fuelMass: 50, mass: 1050 },
    })
  })
})
