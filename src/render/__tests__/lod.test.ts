import { describe, expect, it } from 'vitest'
import {
  projectedRadiusPx,
  shouldSuppressChildSprite,
  shouldUseBodySprite,
  spriteWorldSize,
} from '../lod'

describe('projectedRadiusPx', () => {
  it('converts world radius and distance to projected pixels', () => {
    const projected = projectedRadiusPx(10, 100, 1000)

    expect(projected).toBeCloseTo(100)
  })
})

describe('shouldUseBodySprite', () => {
  it('uses a sprite when projected radius falls below the mesh threshold', () => {
    expect(shouldUseBodySprite(5.9, 6)).toBe(true)
  })

  it('keeps the mesh when projected radius meets the mesh threshold', () => {
    expect(shouldUseBodySprite(6, 6)).toBe(false)
  })
})

describe('shouldSuppressChildSprite', () => {
  it('suppresses a child sprite when its screen separation from parent is too small', () => {
    expect(shouldSuppressChildSprite(17.9, 18)).toBe(true)
  })

  it('keeps a child sprite when it is far enough from parent on screen', () => {
    expect(shouldSuppressChildSprite(18, 18)).toBe(false)
  })
})

describe('spriteWorldSize', () => {
  it('converts desired pixel size to world size at distance', () => {
    expect(spriteWorldSize(12, 100, 1000)).toBeCloseTo(1.2)
  })
})
