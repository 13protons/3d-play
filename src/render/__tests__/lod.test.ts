import { describe, expect, it } from 'vitest'
import {
  bodySphereSegmentsForCameraDistance,
  projectedRadiusPx,
  sphereSegmentsForVehicleDistance,
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

describe('sphereSegmentsForVehicleDistance', () => {
  it('uses very high-resolution body spheres at touchdown altitude', () => {
    expect(sphereSegmentsForVehicleDistance(10, 10)).toBe(512)
  })

  it('keeps high-resolution body spheres for low flight near the surface', () => {
    expect(sphereSegmentsForVehicleDistance(10.05, 10)).toBe(512)
  })

  it('uses very high-resolution body spheres below one radius above the surface', () => {
    expect(sphereSegmentsForVehicleDistance(19, 10)).toBe(512)
  })

  it('uses high-resolution body spheres at the one-radius transition band', () => {
    expect(sphereSegmentsForVehicleDistance(20, 10)).toBe(128)
  })
})

describe('bodySphereSegmentsForCameraDistance', () => {
  it('uses very high-resolution body spheres when camera is within one radius of the surface', () => {
    expect(bodySphereSegmentsForCameraDistance({ distanceToCamera: 11, bodyRadius: 10 })).toBe(512)
  })

  it('uses high-resolution body spheres before dropping to normal far LOD', () => {
    expect(bodySphereSegmentsForCameraDistance({ distanceToCamera: 25, bodyRadius: 10 })).toBe(128)
    expect(bodySphereSegmentsForCameraDistance({ distanceToCamera: 40, bodyRadius: 10 })).toBe(32)
  })
})
