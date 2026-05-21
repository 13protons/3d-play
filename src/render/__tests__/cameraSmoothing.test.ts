import { describe, expect, it } from 'vitest'
import { cameraUpLerpAlpha } from '../cameraSmoothing'

describe('cameraUpLerpAlpha', () => {
  it('returns a partial lerp alpha for a normal frame', () => {
    const alpha = cameraUpLerpAlpha(1 / 60)

    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThan(1)
  })

  it('clamps large frame gaps to avoid snapping past the target', () => {
    expect(cameraUpLerpAlpha(10)).toBe(1)
  })
})
