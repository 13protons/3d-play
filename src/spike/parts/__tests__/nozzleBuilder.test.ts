import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { buildBellNozzle } from '../nozzleBuilder'

describe('buildBellNozzle', () => {
  it('runs from throat at z=0 to exit at z=-length', () => {
    const box = new Box3().setFromObject(buildBellNozzle({ throatRadius: 0.5, exitRadius: 1.4, length: 2.4 }))
    expect(box.max.z).toBeCloseTo(0, 3)
    expect(box.min.z).toBeCloseTo(-2.4, 3)
  })

  it('is widest at the exit radius', () => {
    const box = new Box3().setFromObject(buildBellNozzle({ throatRadius: 0.5, exitRadius: 1.4, length: 2.4 }))
    expect(box.max.x).toBeCloseTo(1.4, 1)
  })
})
