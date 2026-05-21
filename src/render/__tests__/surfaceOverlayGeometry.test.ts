import { describe, expect, it } from 'vitest'
import {
  createSphericalCapOverlayGeometryData,
  TERRAIN_OVERLAY_VISUAL_BIAS,
} from '../surfaceOverlayGeometry'

describe('createSphericalCapOverlayGeometryData', () => {
  it('does not offset terrain above its sampled surface by default', () => {
    expect(TERRAIN_OVERLAY_VISUAL_BIAS).toBe(0)
  })

  it('places the center vertex at the vehicle contact origin plus visual bias', () => {
    const geometry = createSphericalCapOverlayGeometryData({
      centerDirection: [1, 0, 0],
      radius: 100,
      size: 20,
      segments: 2,
      visualBias: 1,
    })

    const center = 4 * 3
    expect(Array.from(geometry.positions.slice(center, center + 3))).toEqual([1, 0, 0])
  })

  it('keeps all vertices on the parent-centered biased sphere radius', () => {
    const geometry = createSphericalCapOverlayGeometryData({
      centerDirection: [0, 1, 0],
      radius: 100,
      size: 20,
      segments: 4,
      visualBias: 2,
    })

    for (let i = 0; i < geometry.positions.length; i += 3) {
      const parentCenteredPosition = [
        geometry.positions[i],
        geometry.positions[i + 1] + 100,
        geometry.positions[i + 2],
      ]
      const length = Math.hypot(
        parentCenteredPosition[0],
        parentCenteredPosition[1],
        parentCenteredPosition[2],
      )
      expect(length).toBeCloseTo(102)
    }
  })

  it('generates equirectangular uvs within texture bounds', () => {
    const geometry = createSphericalCapOverlayGeometryData({
      centerDirection: [1, 0, 0],
      radius: 100,
      size: 20,
      segments: 4,
      visualBias: 0,
    })

    for (const uv of geometry.uvs) {
      expect(uv).toBeGreaterThanOrEqual(0)
      expect(uv).toBeLessThanOrEqual(1)
    }
  })

  it('indexes two triangles per grid cell', () => {
    const geometry = createSphericalCapOverlayGeometryData({
      centerDirection: [1, 0, 0],
      radius: 100,
      size: 20,
      segments: 3,
      visualBias: 0,
    })

    expect(geometry.indices).toHaveLength(3 * 3 * 6)
  })
})
