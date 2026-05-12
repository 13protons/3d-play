import { describe, expect, it } from 'vitest'
import {
  bodyRotationAngle,
  craftDebugAxisSegments,
  rotatingBodyTransform,
  rotationAxisPoints,
  shouldShowBodyRotationAxisInView,
  shouldShowRotationAxis,
  shouldShowRotationSurfaceMarker,
  surfaceRotationMarkerPoints,
} from '../rotation'

describe('bodyRotationAngle', () => {
  it('advances phase by angular velocity and sim time', () => {
    expect(bodyRotationAngle(0.5, 2, 10)).toBeCloseTo(20.5)
  })
})

describe('rotatingBodyTransform', () => {
  it('keeps world placement on the rotating group so spin does not rotate orbital position', () => {
    expect(rotatingBodyTransform([100, 200, 300])).toEqual({
      groupPosition: [100, 200, 300],
      meshPosition: [0, 0, 0],
    })
  })
})

describe('craftDebugAxisSegments', () => {
  it('centers all craft-local axes on the origin COM', () => {
    expect(craftDebugAxisSegments(2)).toEqual({
      x: [[-2, 0, 0], [2, 0, 0]],
      y: [[0, -2, 0], [0, 2, 0]],
      z: [[0, 0, -2], [0, 0, 2]],
      thrust: [[0, 0, 0], [0, 0, 2.6]],
      cot: [0, 0, -2.6],
    })
  })
})

describe('shouldShowRotationAxis', () => {
  it('shows only while body mesh is visible and the debug toggle is enabled', () => {
    expect(shouldShowRotationAxis(false, true)).toBe(false)
    expect(shouldShowRotationAxis(true, false)).toBe(false)
    expect(shouldShowRotationAxis(true, true)).toBe(true)
  })
})

describe('shouldShowBodyRotationAxisInView', () => {
  it('hides celestial body axes in vehicle view so the craft overlay is isolated', () => {
    expect(shouldShowBodyRotationAxisInView('orbital', true)).toBe(true)
    expect(shouldShowBodyRotationAxisInView('vehicle', true)).toBe(false)
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
