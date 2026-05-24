import { describe, expect, it } from 'vitest'
import {
  clampCameraAboveLocalSurface,
  SURFACE_CAMERA_MIN_HEIGHT,
  shouldHideBodySphereForLocalSurface,
  shouldClampCameraAboveLocalSurface,
  shouldShowLocalSurfacePatch,
  surfacePatchSizeForCameraDistance,
  surfacePatchFrame,
} from '../surfacePatch'

describe('surfacePatchFrame', () => {
  it('places the local surface patch at the vehicle contact point', () => {
    expect(surfacePatchFrame([-1, 0, 0]).position).toEqual([0, 0, 0])
  })

  it('normalizes the patch normal from radial out', () => {
    expect(surfacePatchFrame([-2, 0, 0]).normal).toEqual([-1, 0, 0])
  })
})

describe('shouldHideBodySphereForLocalSurface', () => {
  it('keeps the parent body sphere visible while a local landed terrain overlay is active', () => {
    expect(shouldHideBodySphereForLocalSurface({
      bodyId: 'earth',
      vehicleParentId: 'earth',
      surfaceState: 'landed',
      cameraDistance: 100,
    })).toBe(false)
  })

  it('keeps other body spheres visible', () => {
    expect(shouldHideBodySphereForLocalSurface({
      bodyId: 'moon',
      vehicleParentId: 'earth',
      surfaceState: 'landed',
      cameraDistance: 100,
    })).toBe(false)
  })

  it('keeps the parent body sphere visible while flying', () => {
    expect(shouldHideBodySphereForLocalSurface({
      bodyId: 'earth',
      vehicleParentId: 'earth',
      surfaceState: 'flying',
      cameraDistance: 100,
    })).toBe(false)
  })

  it('keeps the parent body sphere visible after zooming beyond local surface range', () => {
    expect(shouldHideBodySphereForLocalSurface({
      bodyId: 'earth',
      vehicleParentId: 'earth',
      surfaceState: 'landed',
      cameraDistance: 2_500,
    })).toBe(false)
  })

  it('keeps the parent body sphere visible through the local-to-orbital transition band', () => {
    expect(shouldHideBodySphereForLocalSurface({
      bodyId: 'earth',
      vehicleParentId: 'earth',
      surfaceState: 'landed',
      cameraDistance: 1_500,
    })).toBe(false)
  })
})

describe('surfacePatchSizeForCameraDistance', () => {
  it('serves a larger local patch as the camera backs away', () => {
    expect(surfacePatchSizeForCameraDistance(100)).toBeGreaterThan(200)
  })

  it('caps the patch before orbital-scale views', () => {
    expect(surfacePatchSizeForCameraDistance(10_000)).toBe(2_000)
  })
})

describe('shouldShowLocalSurfacePatch', () => {
  it('shows the local terrain patch while flying within one parent radius of the surface', () => {
    expect(shouldShowLocalSurfacePatch({
      surfaceState: 'flying',
      cameraDistance: 1_500,
      bodyDistance: 6_372_800,
      bodyRadius: 6_371_000,
    })).toBe(true)
  })

  it('keeps the local tangent patch visible through the transition band', () => {
    expect(shouldShowLocalSurfacePatch({
      surfaceState: 'landed',
      cameraDistance: 1_500,
      bodyDistance: 6_371_000,
      bodyRadius: 6_371_000,
    })).toBe(true)
  })

  it('hides the local tangent patch after zooming beyond local surface range', () => {
    expect(shouldShowLocalSurfacePatch({
      surfaceState: 'landed',
      cameraDistance: 2_500,
      bodyDistance: 6_371_000,
      bodyRadius: 6_371_000,
    })).toBe(false)
  })

  it('hides the flying local terrain patch beyond one parent radius above the surface', () => {
    expect(shouldShowLocalSurfacePatch({
      surfaceState: 'flying',
      cameraDistance: 1_500,
      bodyDistance: 12_800_000,
      bodyRadius: 6_371_000,
    })).toBe(false)
  })
})

describe('clampCameraAboveLocalSurface', () => {
  it('keeps the camera above the rendered terrain surface', () => {
    expect(SURFACE_CAMERA_MIN_HEIGHT).toBeGreaterThan(1)
  })

  it('pushes cameras below the local tangent surface back above it', () => {
    expect(clampCameraAboveLocalSurface([0, -2, 5], [0, 1, 0], 1)).toEqual([0, 1, 5])
  })

  it('does not move cameras already above the local surface', () => {
    expect(clampCameraAboveLocalSurface([0, 3, 5], [0, 1, 0], 1)).toEqual([0, 3, 5])
  })
})

describe('shouldClampCameraAboveLocalSurface', () => {
  it('does not clamp while the vehicle is flying in surface reference mode', () => {
    expect(shouldClampCameraAboveLocalSurface({
      surfaceState: 'flying',
      referenceMode: 'surface',
    })).toBe(false)
  })

  it('clamps while the vehicle is actually contacting the surface', () => {
    expect(shouldClampCameraAboveLocalSurface({
      surfaceState: 'landed',
      referenceMode: 'surface',
    })).toBe(true)
  })
})
