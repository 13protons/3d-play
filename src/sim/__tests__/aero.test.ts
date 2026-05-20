import { describe, expect, it } from 'vitest'
import { computeAeroForce, exponentialAtmosphereDensity } from '../vehicle/aero'
import type { AeroForceInput } from '../vehicle/aero'

const baseInput: AeroForceInput = {
  vehicle: {
    vehicleId: 'vehicle-1',
    parentId: 'earth',
    simTime: 0,
    position: [6_471_000, 0, 0],
    velocity: [0, 0, 1000],
    orientation: [0, 0, 0, 1],
    angularVelocity: [0, 0, 0],
  },
  resources: { dryMass: 1000, fuelMass: 0, mass: 1000 },
  aero: { model: 'simple-drag', dragCoefficient: 2, referenceArea: 10 },
  parent: {
    id: 'earth',
    radius: 6_371_000,
    position: [0, 0, 0],
    velocity: [0, 0, 0],
    angularVelocity: 0,
    rotationAxisWorld: [0, 1, 0],
    atmosphere: {
      loadRadiusMultiplier: 1.25,
      model: 'exponential',
      surfaceDensity: 1.225,
      scaleHeight: 8500,
      maxAltitude: 120000,
    },
  },
}

describe('exponentialAtmosphereDensity', () => {
  it('returns exponential density until max altitude', () => {
    const atmosphere = baseInput.parent.atmosphere!

    expect(exponentialAtmosphereDensity(atmosphere, 0)).toBeCloseTo(1.225)
    expect(exponentialAtmosphereDensity(atmosphere, 8500)).toBeCloseTo(1.225 / Math.E)
    expect(exponentialAtmosphereDensity(atmosphere, 120001)).toBe(0)
  })
})

describe('computeAeroForce', () => {
  it('returns drag opposite relative air velocity', () => {
    const output = computeAeroForce(baseInput)

    expect(output.forceWorld[0]).toBeCloseTo(0)
    expect(output.forceWorld[1]).toBeCloseTo(0)
    expect(output.forceWorld[2]).toBeLessThan(0)
    expect(output.torqueWorld).toEqual([0, 0, 0])
    expect(output.diagnostics.model).toBe('simple-drag')
    expect(output.diagnostics.dynamicPressure).toBeGreaterThan(0)
  })

  it('uses parent co-rotation in relative air velocity', () => {
    const output = computeAeroForce({
      ...baseInput,
      vehicle: { ...baseInput.vehicle, velocity: [0, 0, 0] },
      parent: { ...baseInput.parent, angularVelocity: 1 },
    })

    expect(output.diagnostics.atmosphereVelocityWorld[2]).toBeCloseTo(-6_471_000)
    expect(output.diagnostics.relativeAirVelocityWorld[2]).toBeCloseTo(6_471_000)
    expect(output.forceWorld[2]).toBeLessThan(0)
  })

  it('returns finite zero force when inactive or speed is zero', () => {
    const noAtmosphere = computeAeroForce({
      ...baseInput,
      parent: { ...baseInput.parent, atmosphere: undefined },
    })
    expect(noAtmosphere.forceWorld).toEqual([0, 0, 0])

    const noSpeed = computeAeroForce({
      ...baseInput,
      vehicle: { ...baseInput.vehicle, velocity: [0, 0, 0] },
    })
    expect(noSpeed.forceWorld).toEqual([0, 0, 0])
    expect(noSpeed.forceWorld.every(Number.isFinite)).toBe(true)
  })

  it('returns zero force without resources or aero', () => {
    const noResources = computeAeroForce({ ...baseInput, resources: undefined })
    const noAero = computeAeroForce({ ...baseInput, aero: undefined })

    expect(noResources.forceWorld).toEqual([0, 0, 0])
    expect(noAero.forceWorld).toEqual([0, 0, 0])
  })

  it('is inactive outside load radius', () => {
    const output = computeAeroForce({
      ...baseInput,
      vehicle: { ...baseInput.vehicle, position: [8_000_000, 0, 0] },
    })

    expect(output.forceWorld).toEqual([0, 0, 0])
    expect(output.diagnostics.model).toBe('none')
  })
})
