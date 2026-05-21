import { describe, expect, it } from 'vitest'
import { computeFlightReferenceFrame, referenceFrameRetrogradeDirection } from '../vehicle/referenceFrame'

const earthRadius = 6_371_000
const earthGm = 3.98600435436e14

describe('computeFlightReferenceFrame', () => {
  it('selects surface for an impacting trajectory below 1.1 radii', () => {
    const result = computeFlightReferenceFrame({
      relativePosition: [earthRadius + 100_000, 0, 0],
      relativeVelocity: [0, -500, 7_000],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })

    expect(result.mode).toBe('surface')
  })

  it('stays orbital for an impacting trajectory above 1.1 radii', () => {
    const result = computeFlightReferenceFrame({
      relativePosition: [earthRadius * 1.5, 0, 0],
      relativeVelocity: [0, -500, 5_000],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })

    expect(result.mode).toBe('orbital')
  })

  it('stays orbital for a low non-impacting orbit', () => {
    const r = earthRadius + 100_000
    const result = computeFlightReferenceFrame({
      relativePosition: [r, 0, 0],
      relativeVelocity: [0, 0, Math.sqrt(earthGm / r)],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })

    expect(result.mode).toBe('orbital')
  })

  it('stays orbital for a hyperbolic flyby even below the altitude threshold', () => {
    const result = computeFlightReferenceFrame({
      relativePosition: [earthRadius + 100_000, 0, 0],
      relativeVelocity: [0, 0, 12_000],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })

    expect(result.mode).toBe('orbital')
  })

  it('selects surface for landed or crashed vehicles', () => {
    for (const surfaceState of ['landed', 'crashed'] as const) {
      const result = computeFlightReferenceFrame({
        relativePosition: [earthRadius, 0, 0],
        relativeVelocity: [0, 0, 0],
        parentRadius: earthRadius,
        parentGm: earthGm,
        parentAngularVelocity: 0,
        parentRotationAxis: [0, 1, 0],
        surfaceState,
      })

      expect(result.mode).toBe('surface')
    }
  })

  it('subtracts rotating surface velocity in surface mode', () => {
    const result = computeFlightReferenceFrame({
      relativePosition: [earthRadius, 0, 0],
      relativeVelocity: [0, 0, 0],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 1,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'landed',
    })

    expect(result.surfaceVelocity[2]).toBeCloseTo(earthRadius)
    expect(result.navVelocity).toEqual(result.surfaceVelocity)
  })

  it('uses surface-relative nav velocity for retrograde direction in surface mode', () => {
    const retrograde = referenceFrameRetrogradeDirection({
      relativePosition: [earthRadius, 0, 0],
      relativeVelocity: [1000, 0, 0],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 1,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'landed',
    })

    expect(retrograde[0]).toBeCloseTo(-1000 / Math.hypot(1000, earthRadius))
    expect(retrograde[1]).toBeCloseTo(0)
    expect(retrograde[2]).toBeCloseTo(-earthRadius / Math.hypot(1000, earthRadius))
  })
})
