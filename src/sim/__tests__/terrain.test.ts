import { describe, expect, it } from 'vitest'
import { sampleSphericalTerrain } from '../terrain'

describe('sampleSphericalTerrain', () => {
  it('samples a zero-height spherical surface for the initial terrain provider', () => {
    const sample = sampleSphericalTerrain({
      bodyId: 'earth',
      bodyRadius: 6_371_000,
      direction: [2, 0, 0],
    })

    expect(sample.bodyId).toBe('earth')
    expect(sample.height).toBe(0)
    expect(sample.radius).toBe(6_371_000)
    expect(sample.normal).toEqual([1, 0, 0])
  })

  it('falls back to radial out when the direction cannot be normalized', () => {
    const sample = sampleSphericalTerrain({
      bodyId: 'earth',
      bodyRadius: 6_371_000,
      direction: [0, 0, 0],
    })

    expect(sample.normal).toEqual([1, 0, 0])
  })
})
