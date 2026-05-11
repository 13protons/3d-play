import { describe, expect, it } from 'vitest'
import { isSunOccluded, projectDistantSphere } from '../lighting'

describe('isSunOccluded', () => {
  it('returns true when a body intersects the vehicle-to-sun line segment', () => {
    const occluded = isSunOccluded(
      [0, 0, 0],
      [10, 0, 0],
      [{ id: 'earth', position: [5, 0, 0], radius: 1 }],
    )

    expect(occluded).toBe(true)
  })

  it('returns false when a body is near but clear of the vehicle-to-sun line', () => {
    const occluded = isSunOccluded(
      [0, 0, 0],
      [10, 0, 0],
      [{ id: 'earth', position: [5, 2, 0], radius: 1 }],
    )

    expect(occluded).toBe(false)
  })

  it('ignores bodies behind the vehicle or beyond the sun', () => {
    const occluded = isSunOccluded(
      [0, 0, 0],
      [10, 0, 0],
      [
        { id: 'behind', position: [-1, 0, 0], radius: 2 },
        { id: 'beyond', position: [12, 0, 0], radius: 2 },
      ],
    )

    expect(occluded).toBe(false)
  })
})

describe('projectDistantSphere', () => {
  it('projects a distant body to a fixed render distance', () => {
    const projected = projectDistantSphere([0, 0, 0], [1000, 0, 0], 10, 100)

    expect(projected.position).toEqual([100, 0, 0])
  })

  it('preserves angular radius at the projected distance', () => {
    const projected = projectDistantSphere([0, 0, 0], [1000, 0, 0], 10, 100)

    expect(projected.radius).toBeCloseTo(1)
  })
})
