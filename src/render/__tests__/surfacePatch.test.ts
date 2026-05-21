import { describe, expect, it } from 'vitest'
import {
  clampCameraAboveLocalSurface,
  shouldHideBodySphereForLocalSurface,
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
  it('hides the parent body sphere when a local landed surface patch is active', () => {
    expect(shouldHideBodySphereForLocalSurface('earth', 'earth', 'landed')).toBe(true)
  })

  it('keeps other body spheres visible', () => {
    expect(shouldHideBodySphereForLocalSurface('moon', 'earth', 'landed')).toBe(false)
  })

  it('keeps the parent body sphere visible while flying', () => {
    expect(shouldHideBodySphereForLocalSurface('earth', 'earth', 'flying')).toBe(false)
  })
})

describe('clampCameraAboveLocalSurface', () => {
  it('pushes cameras below the local tangent surface back above it', () => {
    expect(clampCameraAboveLocalSurface([0, -2, 5], [0, 1, 0], 1)).toEqual([0, 1, 5])
  })

  it('does not move cameras already above the local surface', () => {
    expect(clampCameraAboveLocalSurface([0, 3, 5], [0, 1, 0], 1)).toEqual([0, 3, 5])
  })
})
