import { describe, expect, it } from 'vitest'
import {
  computeNavballCompassFrame,
  computeNavballFrame,
  computeNavballMarkers,
  computeNavballState,
  eulerDegreesToQuaternion,
  projectNavballVector,
  shouldRenderNavballMarker,
  visibleNavballSegments,
} from '../navballMath'

describe('eulerDegreesToQuaternion', () => {
  it('returns identity for zero attitude', () => {
    expect(eulerDegreesToQuaternion({ yaw: 0, pitch: 0, roll: 0 })).toEqual([0, 0, 0, 1])
  })

  it('rotates navball markers when yaw changes', () => {
    const markers = computeNavballMarkers({
      orientation: eulerDegreesToQuaternion({ yaw: 90, pitch: 0, roll: 0 }),
      relativePosition: [1, 0, 0],
      relativeVelocity: [0, 0, 1],
      radius: 50,
    })

    expect(markers.prograde.x).toBeCloseTo(-50)
    expect(markers.prograde.visible).toBe(true)
  })
})

describe('computeNavballCompassFrame', () => {
  it('builds cardinal vectors from the projected parent rotation axis at the equator', () => {
    const compass = computeNavballCompassFrame({
      relativePosition: [1, 0, 0],
      parentRotationAxis: [0, 1, 0],
    })

    expect(compass?.north).toEqual([0, 1, 0])
    expect(compass?.south).toEqual([0, -1, 0])
    expect(compass?.east).toEqual([0, 0, -1])
    expect(compass?.west).toEqual([0, 0, 1])
  })

  it('omits compass vectors for polar or invalid inputs', () => {
    expect(
      computeNavballCompassFrame({
        relativePosition: [0, 1, 0],
        parentRotationAxis: [0, 1, 0],
      })
    ).toBeNull()
    expect(
      computeNavballCompassFrame({
        relativePosition: [0, 0, 0],
        parentRotationAxis: [0, 1, 0],
      })
    ).toBeNull()
    expect(
      computeNavballCompassFrame({
        relativePosition: [1, 0, 0],
        parentRotationAxis: [0, 0, 0],
      })
    ).toBeNull()
    expect(
      computeNavballCompassFrame({
        relativePosition: [Number.POSITIVE_INFINITY, 0, 0],
        parentRotationAxis: [0, 1, 0],
      })
    ).toBeNull()
    expect(
      computeNavballCompassFrame({
        relativePosition: [1, 0, 0],
        parentRotationAxis: [0, Number.NaN, 0],
      })
    ).toBeNull()
  })
})

describe('computeNavballFrame', () => {
  it('builds orbital direction vectors from parent-relative state', () => {
    const frame = computeNavballFrame({
      relativePosition: [10, 0, 0],
      relativeVelocity: [0, 20, 0],
    })

    expect(frame.radialOut).toEqual([1, 0, 0])
    expect(frame.radialIn).toEqual([-1, 0, 0])
    expect(frame.prograde).toEqual([0, 1, 0])
    expect(frame.retrograde).toEqual([0, -1, 0])
    expect(frame.normal).toEqual([0, 0, 1])
    expect(frame.antiNormal).toEqual([0, 0, -1])
  })
})

describe('projectNavballVector', () => {
  it('places a craft-forward vector at the center of the ball', () => {
    expect(projectNavballVector([0, 0, 1], 50)).toEqual({ x: 0, y: 0, visible: true })
  })

  it('places right and up vectors on the ball rim', () => {
    expect(projectNavballVector([1, 0, 0], 50)).toEqual({ x: 50, y: 0, visible: true })
    expect(projectNavballVector([0, 1, 0], 50)).toEqual({ x: 0, y: -50, visible: true })
  })

  it('marks backside vectors as hidden while keeping their rim direction', () => {
    expect(projectNavballVector([0, 0, -1], 50)).toEqual({ x: 0, y: 0, visible: false })
  })
})

describe('shouldRenderNavballMarker', () => {
  it('hides backside markers instead of dimming them over the crosshair', () => {
    expect(shouldRenderNavballMarker({ x: 0, y: 0, visible: false })).toBe(false)
    expect(shouldRenderNavballMarker({ x: 0, y: 0, visible: true })).toBe(true)
  })
})

describe('visibleNavballSegments', () => {
  it('splits visible horizon samples instead of connecting across hidden gaps', () => {
    const segments = visibleNavballSegments([
      { x: -10, y: 0, visible: true },
      { x: 0, y: 0, visible: false },
      { x: 10, y: 0, visible: true },
    ])

    expect(segments).toEqual([
      [{ x: -10, y: 0, visible: true }],
      [{ x: 10, y: 0, visible: true }],
    ])
  })
})

describe('computeNavballMarkers', () => {
  it('rotates world orbital markers into craft-local navball space', () => {
    const markers = computeNavballMarkers({
      orientation: [0, 0, 0, 1],
      relativePosition: [10, 0, 0],
      relativeVelocity: [0, 0, 20],
      radius: 50,
    })

    expect(markers.prograde).toMatchObject({ x: 0, y: 0, visible: true })
    expect(markers.radialOut).toMatchObject({ x: 50, y: 0, visible: true })
    expect(markers.retrograde.visible).toBe(false)
  })

  it('hides prograde and retrograde when speed is below the threshold', () => {
    const markers = computeNavballMarkers({
      orientation: [0, 0, 0, 1],
      relativePosition: [10, 0, 0],
      relativeVelocity: [0, 0, 0.005],
      radius: 50,
    })

    expect(markers.prograde.visible).toBe(false)
    expect(markers.retrograde.visible).toBe(false)
    // Other markers should still render — radial and normal are defined by position.
    expect(markers.radialOut.visible).toBe(true)
  })
})

describe('computeNavballState', () => {
  it('draws an orbital horizon from radial out/in preparation for surface mode', () => {
    const state = computeNavballState({
      orientation: [0, 0, 0, 1],
      relativePosition: [0, 1, 0],
      relativeVelocity: [0, 0, 1],
      radius: 50,
    })

    expect(state.horizon.length).toBeGreaterThan(8)
    expect(state.markers.radialOut.y).toBe(-50)
    expect(state.markers.radialIn.y).toBe(50)
  })

  it('uses the provided nav velocity for prograde markers', () => {
    const state = computeNavballState({
      orientation: [0, 0, 0, 1],
      relativePosition: [1, 0, 0],
      relativeVelocity: [0, 0, 1],
      radius: 50,
    })

    expect(state.markers.prograde).toMatchObject({ x: 0, y: 0, visible: true })
  })

  it('projects compass markers through craft-local navball space', () => {
    const state = computeNavballState({
      orientation: [0, 0, 0, 1],
      relativePosition: [1, 0, 0],
      relativeVelocity: [0, 0, 1],
      parentRotationAxis: [0, 1, 0],
      radius: 50,
    })

    expect(state.compass?.north).toMatchObject({ x: 0, y: -50, visible: true })
    expect(state.compass?.south).toMatchObject({ x: 0, y: 50, visible: true })
    expect(state.compass?.east.visible).toBe(false)
    expect(state.compass?.west).toMatchObject({ x: 0, y: 0, visible: true })
  })

  it('omits compass markers at the pole', () => {
    const state = computeNavballState({
      orientation: [0, 0, 0, 1],
      relativePosition: [0, 1, 0],
      relativeVelocity: [0, 0, 1],
      parentRotationAxis: [0, 1, 0],
      radius: 50,
    })

    expect(state.compass).toBeNull()
  })
})
