import { describe, expect, it } from 'vitest'
import { advanceTo } from '../integrator/adaptive'
import { pointMassDerivatives } from '../integrator/derivatives'
import { vehicleDerivatives } from '../vehicle/dynamics'
import type { TrajectoryCurve } from '../types'

describe('vehicleDerivatives with aero', () => {
  it('loses orbital energy in low Earth atmosphere', () => {
    const earthRadius = 6_371_000
    const altitude = 80_000
    const r = earthRadius + altitude
    const gm = 3.98600435436e14
    const v = Math.sqrt(gm / r)
    const state = new Float64Array([r, 0, 0, 0, 0, v])
    const bodyCurves: TrajectoryCurve[] = [{
      id: 'earth',
      parentId: 'sun',
      p0: [0, 0, 0],
      v0: [0, 0, 0],
      t0: 0,
      p1: [0, 0, 0],
      v1: [0, 0, 0],
      t1: 60,
    }]
    const gravity = pointMassDerivatives(bodyCurves, new Map([['earth', gm]]))
    const derivative = vehicleDerivatives({
      gravity,
      parentId: 'earth',
      bodyCurves,
      bodySurfaces: new Map([['earth', {
        radius: earthRadius,
        angularVelocity: 0,
        rotationAxis: [0, 1, 0],
        atmosphere: {
          loadRadiusMultiplier: 1.25,
          model: 'exponential',
          surfaceDensity: 1.225,
          scaleHeight: 8500,
          maxAltitude: 120000,
        },
      }]]),
      resources: { dryMass: 1000, fuelMass: 0, mass: 1000 },
      aero: { model: 'simple-drag', dragCoefficient: 2.2, referenceArea: 10 },
      orientation: [0, 0, 0, 1],
      angularVelocity: [0, 0, 0],
      throttle: 0,
      simTime: 0,
    })
    const initialEnergy = specificEnergy(state, gm)

    advanceTo(state, 0, 10, derivative, 1e-10)

    expect(specificEnergy(state, gm)).toBeLessThan(initialEnergy)
  })
})

function specificEnergy(state: Float64Array, gm: number): number {
  const speed = Math.hypot(state[3], state[4], state[5])
  const radius = Math.hypot(state[0], state[1], state[2])
  return 0.5 * speed * speed - gm / radius
}
