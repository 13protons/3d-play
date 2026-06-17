import { describe, expect, it } from 'vitest'
import { computeFlightReferenceFrame, surfaceFrame } from '../vehicle/referenceFrame'

const earthRadius = 6_371_000
const earthGm = 3.98600435436e14

describe('surfaceFrame', () => {
  const close = (a: readonly number[], b: readonly number[]) =>
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6))

  it('builds a right-handed up/north/east frame from position and spin axis', () => {
    // On the equator at +X, with the spin axis along +Y.
    const frame = surfaceFrame([earthRadius, 0, 0], [0, 1, 0])
    expect(frame).not.toBeNull()
    close(frame!.up, [1, 0, 0])
    close(frame!.north, [0, 1, 0]) // toward the spin axis
    close(frame!.east, [0, 0, -1]) // north × up
    // right-handed: east × north = up
    const exn: [number, number, number] = [
      frame!.east[1] * frame!.north[2] - frame!.east[2] * frame!.north[1],
      frame!.east[2] * frame!.north[0] - frame!.east[0] * frame!.north[2],
      frame!.east[0] * frame!.north[1] - frame!.east[1] * frame!.north[0],
    ]
    close(exn, frame!.up)
  })

  it('returns null at a pole (up parallel to the spin axis)', () => {
    expect(surfaceFrame([0, earthRadius, 0], [0, 1, 0])).toBeNull()
  })
})

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
    expect(result.orbit.kind).toBe('impacting')
    expect(result.orbit.periapsisAltitude).toBeLessThanOrEqual(0)
    expect(result.orbit.apoapsisAltitude).not.toBeNull()
  })

  it('selects surface for an impacting trajectory above 1.1 radii', () => {
    const result = computeFlightReferenceFrame({
      relativePosition: [earthRadius * 1.5, 0, 0],
      relativeVelocity: [0, -500, 5_000],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })

    expect(result.mode).toBe('surface')
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
    expect(result.orbit.kind).toBe('closed')
    expect(result.orbit.periapsisAltitude).toBeCloseTo(100_000)
    expect(result.orbit.apoapsisAltitude).toBeCloseTo(100_000)
  })

  it('reports uncapped apoapsis for a near-parabolic bound orbit', () => {
    const periapsisRadius = earthRadius + 100_000
    const apoapsisRadius = 1e21
    const semiMajorAxis = (periapsisRadius + apoapsisRadius) / 2
    const periapsisSpeed = Math.sqrt(earthGm * (2 / periapsisRadius - 1 / semiMajorAxis))
    const result = computeFlightReferenceFrame({
      relativePosition: [periapsisRadius, 0, 0],
      relativeVelocity: [0, 0, periapsisSpeed],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })

    expect(result.orbit.kind).toBe('closed')
    expect(result.orbit.apoapsisAltitude).not.toBeNull()
    expect(result.orbit.apoapsisAltitude ?? 0).toBeGreaterThan(apoapsisRadius / 2)
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
    expect(result.orbit.kind).toBe('open')
    expect(result.orbit.periapsisAltitude).toBeGreaterThan(0)
    expect(result.orbit.apoapsisAltitude).toBeNull()
  })

  it('selects surface for a hyperbolic trajectory whose periapsis intersects the body', () => {
    const result = computeFlightReferenceFrame({
      relativePosition: [earthRadius + 100_000, 0, 0],
      relativeVelocity: [-12_000, 0, 0],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })

    expect(result.mode).toBe('surface')
    expect(result.orbit.kind).toBe('impacting')
    expect(result.orbit.periapsisAltitude).toBeLessThanOrEqual(0)
    expect(result.orbit.apoapsisAltitude).toBeNull()
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

  it('subtracts rotating surface velocity for a flying vehicle in surface mode', () => {
    // Impacting trajectory forces surface mode while still flying, so we exercise
    // the ω×r subtraction path (not the landed force-zero path).
    const result = computeFlightReferenceFrame({
      relativePosition: [earthRadius, 0, 0],
      relativeVelocity: [-100, 0, 0],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 1,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })

    expect(result.mode).toBe('surface')
    expect(result.surfaceVelocity[2]).toBeCloseTo(earthRadius)
    expect(result.navVelocity).toEqual(result.surfaceVelocity)
  })

  it('reports zero surface velocity for landed and crashed vehicles', () => {
    for (const surfaceState of ['landed', 'crashed'] as const) {
      const result = computeFlightReferenceFrame({
        relativePosition: [earthRadius, 0, 0],
        relativeVelocity: [12, 34, 56],
        parentRadius: earthRadius,
        parentGm: earthGm,
        parentAngularVelocity: 1,
        parentRotationAxis: [0, 1, 0],
        surfaceState,
      })

      expect(result.surfaceVelocity).toEqual([0, 0, 0])
      expect(result.navVelocity).toEqual([0, 0, 0])
    }
  })

  it('reports orbit normal perpendicular to position and velocity', () => {
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

    expect(result.orbitNormal[0]).toBeCloseTo(0)
    expect(result.orbitNormal[1]).toBeCloseTo(-1)
    expect(result.orbitNormal[2]).toBeCloseTo(0)
  })

  it('falls back to parent rotation axis when orbit normal is degenerate', () => {
    const result = computeFlightReferenceFrame({
      relativePosition: [earthRadius, 0, 0],
      relativeVelocity: [0, 0, 0],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'landed',
    })

    expect(result.orbitNormal).toEqual([0, 1, 0])
  })

})
