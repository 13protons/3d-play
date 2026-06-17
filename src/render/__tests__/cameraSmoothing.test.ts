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
    const position = surfaceCameraPosition([-1, 0, 0], [0, 0, 1], 30, 10)

    // Height is along radial-out (-X here).
    expect(position[0]).toBeLessThan(0)
    expect(position[0] * -1).toBeCloseTo(10)
  })

  it('offsets along the requested horizontal direction at the given distance', () => {
    // up = +Y, requested tangent = +Z (e.g. "south"); camera should sit +Z·30, +Y·10.
    const position = surfaceCameraPosition([0, 1, 0], [0, 0, 1], 30, 10)

    expect(position[1]).toBe(10)
    expect(position[2]).toBeCloseTo(30)
    expect(position[0]).toBeCloseTo(0)
  })

  it('projects the tangent onto the surface plane (ignores any up component)', () => {
    // tangent has a big up (+Y) component; only its horizontal (+Z) part should count.
    const position = surfaceCameraPosition([0, 1, 0], [0, 5, 1], 30, 10)
    expect(position[1]).toBe(10)
    expect(position[2]).toBeCloseTo(30)
  })
})
