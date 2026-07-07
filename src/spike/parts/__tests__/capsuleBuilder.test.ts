import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { buildCapsule } from '../capsuleBuilder'

describe('buildCapsule', () => {
  it('is centered on the origin with base at -Z and nose at +Z', () => {
    const box = new Box3().setFromObject(buildCapsule({ radius: 1.6, length: 4 }))
    expect(box.min.z).toBeCloseTo(-2, 2)
    expect(box.max.z).toBeCloseTo(2, 2)
  })

  it('is widest near the base radius', () => {
    const box = new Box3().setFromObject(buildCapsule({ radius: 1.6, length: 4 }))
    expect(box.max.x).toBeCloseTo(1.6, 1)
  })
})
