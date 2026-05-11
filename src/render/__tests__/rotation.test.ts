import { describe, expect, it } from 'vitest'
import {
  bodyRotationAngle,
  rotationAxisPoints,
  shouldShowRotationAxis,
  shouldShowRotationSurfaceMarker,
  surfaceRotationMarkerPoints,
} from '../rotation'

describe('bodyRotationAngle', () => {
  it('advances phase by angular velocity and sim time', () => {
    expect(bodyRotationAngle(0.5, 2, 10)).toBeCloseTo(20.5)
  })
})

describe('shouldShowRotationAxis', () => {
  it('shows only while body mesh is visible and the debug toggle is enabled', () => {
    expect(shouldShowRotationAxis(false, true)).toBe(false)
    expect(shouldShowRotationAxis(true, false)).toBe(false)
    expect(shouldShowRotationAxis(true, true)).toBe(true)
  })
})

describe('shouldShowRotationSurfaceMarker', () => {
  it('does not show the removed body surface marker', () => {
    expect(shouldShowRotationSurfaceMarker(false)).toBe(false)
    expect(shouldShowRotationSurfaceMarker(true)).toBe(false)
  })
})

describe('rotationAxisPoints', () => {
  it('has total length of 2.5 radii', () => {
    expect(rotationAxisPoints(10)).toEqual([
      [0, -12.5, 0],
      [0, 12.5, 0],
    ])
  })
})

describe('surfaceRotationMarkerPoints', () => {
  it('places a short marker just above the body surface', () => {
    expect(surfaceRotationMarkerPoints(10)).toEqual([
      [10.03, -2.5, 0],
      [10.03, 2.5, 0],
    ])
  })
})
