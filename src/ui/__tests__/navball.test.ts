import { describe, expect, it } from 'vitest'
import {
  computeNavballFrame,
  computeNavballMarkers,
  computeNavballState,
  projectNavballVector,
  shouldRenderNavballMarker,
  visibleNavballSegments,
} from '../navballMath'

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
})
