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

  it('mirrors a part tree and deactivates jettisoned parts on staging', () => {
    useVehicleStore.getState().reset()
    const parts = [
      { instanceId: 'b', defId: 'booster', parentInstanceId: null, parentAttachPointId: null, myAttachPointId: 'r', localPosition: [0, 0, 0] as [number, number, number], localRotation: [0, 0, 0, 1] as [number, number, number, number], stage: 0, active: true },
      { instanceId: 'u', defId: 'upper', parentInstanceId: 'b', parentAttachPointId: 't', myAttachPointId: 'b', localPosition: [0, 0, 5] as [number, number, number], localRotation: [0, 0, 0, 1] as [number, number, number, number], stage: 1, active: true },
    ]
    useVehicleStore.getState().setVehicleModel('vehicle-1', {
      resources: { dryMass: 1000, fuelMass: 500 },
      parts,
    })

    useVehicleStore.getState().applyStaging('vehicle-1', ['b'])

    const updated = useVehicleStore.getState().models['vehicle-1'].parts!
    expect(updated.find((p) => p.instanceId === 'b')!.active).toBe(false)
    expect(updated.find((p) => p.instanceId === 'u')!.active).toBe(true)
  })

  it('applyStaging is a no-op for a single-body craft with no parts', () => {
    useVehicleStore.getState().reset()
    useVehicleStore.getState().setVehicleModel('vehicle-1', { resources: { dryMass: 1000, fuelMass: 0 } })
    useVehicleStore.getState().applyStaging('vehicle-1', ['anything'])
    expect(useVehicleStore.getState().models['vehicle-1'].parts).toBeUndefined()
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
