import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { PART_BUILDERS } from '../assemblies'

describe('PART_BUILDERS', () => {
  it('provides the three two-stage-ascent parts', () => {
    expect(Object.keys(PART_BUILDERS).sort()).toEqual(['booster', 'capsule', 'upper'])
  })

  it('booster body radius ≈ 2 and its nozzle extends past the aft face (z < -6)', () => {
    const box = new Box3().setFromObject(PART_BUILDERS.booster())
    expect(box.max.x).toBeCloseTo(2, 0)
    expect(box.min.z).toBeLessThan(-6) // nozzle bell hangs below the -length/2 = -6 face
  })

  it('capsule spans ±2 on Z with radius ≈ 1.6', () => {
    const box = new Box3().setFromObject(PART_BUILDERS.capsule())
    expect(box.max.z).toBeCloseTo(2, 1)
    expect(box.max.x).toBeCloseTo(1.6, 0)
  })
})
