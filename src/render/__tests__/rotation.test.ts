import { describe, expect, it } from 'vitest'
import { Euler, Quaternion, Vector3 } from 'three'
import {
  bodyOrientationEuler,
  bodyRotationAngle,
  bodySurfaceOrientationEuler,
  craftDebugAeroForceSegment,
  craftDebugAxisSegments,
  rotatingBodyTransform,
  vehicleBodyTransform,
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

describe('bodyOrientationEuler', () => {
  it('keeps the tilted spin axis fixed while the body spins', () => {
    const tilt = 23.44
    const expectedAxis = new Vector3(
      -Math.sin((tilt * Math.PI) / 180),
      Math.cos((tilt * Math.PI) / 180),
      0,
    )

    for (const spin of [0, 1, 2]) {
      const axis = new Vector3(0, 1, 0).applyEuler(
        new Euler(...bodyOrientationEuler(spin, tilt)),
      )

      expect(axis.x).toBeCloseTo(expectedAxis.x)
      expect(axis.y).toBeCloseTo(expectedAxis.y)
      expect(axis.z).toBeCloseTo(expectedAxis.z)
    }
  })
})

describe('bodySurfaceOrientationEuler', () => {
  it('uses the same spin and tilt orientation for sphere and tiled surfaces', () => {
    expect(bodySurfaceOrientationEuler({
      rotationPhase: 0.5,
      angularVelocity: 2,
      simTime: 10,
      axialTilt: 23.44,
    })).toEqual(bodyOrientationEuler(20.5, 23.44))
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

describe('vehicleBodyTransform', () => {
  it('places vehicle-view body position on the rotating group so spin only rotates texture', () => {
    expect(vehicleBodyTransform([10, 20, 30])).toEqual({
      groupPosition: [10, 20, 30],
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

describe('craftDebugAeroForceSegment', () => {
  it('returns null for zero force', () => {
    expect(craftDebugAeroForceSegment([0, 0, 0])).toBeNull()
  })

  it('hides tiny aero forces that would only add visual noise', () => {
    expect(craftDebugAeroForceSegment([0, 0, -0.5])).toBeNull()
  })

  it('scales force direction into a clamped debug line', () => {
    expect(craftDebugAeroForceSegment([0, 0, -1000])).toEqual([
      [0, 0, 0],
      [0, 0, expect.closeTo(-1.08761548, 5)],
    ])
  })

  it('saturates very large forces without changing direction', () => {
    expect(craftDebugAeroForceSegment([1e9, 0, 0])).toEqual([
      [0, 0, 0],
      [6, 0, 0],
    ])
    expect(craftDebugAeroForceSegment([1e6, 0, 0])).toEqual([
      [0, 0, 0],
      [6, 0, 0],
    ])
  })

  it('converts world force into craft-local coordinates before drawing inside the craft group', () => {
    const orientation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    )
    const segment = craftDebugAeroForceSegment(
      [0, 0, -1000],
      [orientation.x, orientation.y, orientation.z, orientation.w],
    )

    expect(segment).not.toBeNull()
    const renderedWorldEndpoint = new Vector3(...segment![1]).applyQuaternion(orientation)

    expect(renderedWorldEndpoint.x).toBeCloseTo(0)
    expect(renderedWorldEndpoint.y).toBeCloseTo(0)
    expect(renderedWorldEndpoint.z).toBeCloseTo(-1.08761548)
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
