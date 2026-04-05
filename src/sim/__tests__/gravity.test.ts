import { describe, it, expect } from 'vitest'
import { gravitationalAcceleration } from '../orbital/gravity'
import { G } from '../constants'
import type { CelestialBody } from '../types'

function makeBody(
  overrides: Partial<CelestialBody> & { id: string },
): CelestialBody {
  return {
    name: overrides.id,
    parentId: null,
    mass: 1,
    radius: 1,
    position: { sector: [0, 0, 0], local: [0, 0, 0] },
    velocity: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    angularVelocity: 0,
    ...overrides,
  }
}

describe('gravitationalAcceleration', () => {
  it('computes correct acceleration for two bodies', () => {
    const M = 1e24 // kg
    const r = 1e6 // meters apart
    const bodies = [
      makeBody({ id: 'a', position: { sector: [0, 0, 0], local: [0, 0, 0] } }),
      makeBody({
        id: 'b',
        mass: M,
        position: { sector: [0, 0, 0], local: [r, 0, 0] },
      }),
    ]

    const acc = gravitationalAcceleration(bodies, 0)
    const expected = (G * M) / (r * r) // a = GM/r²

    expect(acc[0]).toBeCloseTo(expected, 5)
    expect(acc[1]).toBeCloseTo(0)
    expect(acc[2]).toBeCloseTo(0)
  })

  it('acceleration points toward the other body', () => {
    const bodies = [
      makeBody({ id: 'a', position: { sector: [0, 0, 0], local: [0, 0, 0] } }),
      makeBody({
        id: 'b',
        mass: 1e24,
        position: { sector: [0, 0, 0], local: [0, 0, 1e6] },
      }),
    ]

    const acc = gravitationalAcceleration(bodies, 0)
    expect(acc[2]).toBeGreaterThan(0) // pulled toward +z
    expect(acc[0]).toBeCloseTo(0)
    expect(acc[1]).toBeCloseTo(0)
  })

  it('acceleration is zero from bodies with zero mass', () => {
    const bodies = [
      makeBody({ id: 'a', position: { sector: [0, 0, 0], local: [0, 0, 0] } }),
      makeBody({
        id: 'b',
        mass: 0,
        position: { sector: [0, 0, 0], local: [1e6, 0, 0] },
      }),
    ]

    const acc = gravitationalAcceleration(bodies, 0)
    expect(acc).toEqual([0, 0, 0])
  })

  it('works across sector boundaries', () => {
    const M = 1e24
    const bodies = [
      makeBody({
        id: 'a',
        position: { sector: [0, 0, 0], local: [999999, 0, 0] },
      }),
      makeBody({
        id: 'b',
        mass: M,
        position: { sector: [1, 0, 0], local: [1, 0, 0] },
      }),
    ]

    // Distance = 1 sector - 999999 + 1 = 2 meters
    const acc = gravitationalAcceleration(bodies, 0)
    const expected = (G * M) / (2 * 2) // 2 meters apart
    expect(acc[0]).toBeCloseTo(expected, 0)
  })
})
