import { describe, expect, it } from 'vitest'
import { cameraUpLerpAlpha, surfaceCameraPosition } from '../cameraSmoothing'

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

describe('surfaceCameraPosition', () => {
  it('places the camera above the local surface normal', () => {
    const position = surfaceCameraPosition([-1, 0, 0], 30, 10)

    expect(position[0]).toBeLessThan(0)
    expect(position[0] * -1 + position[1] * 0 + position[2] * 0).toBeGreaterThan(0)
  })

  it('keeps a tangent offset so the vehicle and horizon are visible', () => {
    const position = surfaceCameraPosition([0, 1, 0], 30, 10)

    expect(position[1]).toBe(10)
    expect(Math.hypot(position[0], position[2])).toBeCloseTo(30)
  })
})
