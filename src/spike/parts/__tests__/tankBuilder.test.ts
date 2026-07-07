import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { buildStageBody } from '../tankBuilder'

describe('buildStageBody', () => {
  it('is centered on the origin with its long axis on +Z', () => {
    const box = new Box3().setFromObject(buildStageBody({ radius: 2, length: 12 }))
    expect(box.min.z).toBeCloseTo(-6, 3)
    expect(box.max.z).toBeCloseTo(6, 3)
    // radius (no ribs) ≈ 2 in x and y
    expect(box.max.x).toBeCloseTo(2, 1)
    expect(box.max.y).toBeCloseTo(2, 1)
  })

  it('adds one rib mesh per requested rib ring', () => {
    const plain = buildStageBody({ radius: 2, length: 12, ribs: 0 })
    const ribbed = buildStageBody({ radius: 2, length: 12, ribs: 5 })
    expect(ribbed.children.length).toBe(plain.children.length + 5)
  })

  it('is deterministic for identical params', () => {
    const a = new Box3().setFromObject(buildStageBody({ radius: 1.6, length: 8, ribs: 4 }))
    const b = new Box3().setFromObject(buildStageBody({ radius: 1.6, length: 8, ribs: 4 }))
    expect(a.min.toArray()).toEqual(b.min.toArray())
    expect(a.max.toArray()).toEqual(b.max.toArray())
  })
})
