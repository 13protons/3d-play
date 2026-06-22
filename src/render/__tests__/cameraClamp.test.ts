import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { clampOutsideSphere } from '../cameraClamp'

describe('clampOutsideSphere', () => {
  it('pushes a point inside the sphere out to its surface along the same radial', () => {
    const point = new Vector3(2, 0, 0)
    clampOutsideSphere(point, 0, 0, 0, 10)
    expect(point.length()).toBeCloseTo(10, 6)
    expect(point.x).toBeCloseTo(10, 6)
  })

  it('leaves a point outside the sphere untouched', () => {
    const point = new Vector3(20, 0, 0)
    clampOutsideSphere(point, 0, 0, 0, 10)
    expect(point.x).toBe(20)
  })

  it('clamps against an off-origin centre, preserving direction', () => {
    // 2 units below an off-origin centre, inside radius 4 → pushed to 4 below it.
    const point = new Vector3(5, 3, 0)
    clampOutsideSphere(point, 5, 5, 0, 4)
    expect(point.x).toBeCloseTo(5, 6)
    expect(point.y).toBeCloseTo(1, 6)
  })
})
