import { describe, expect, it } from 'vitest'
import { stateToElements } from '../orbital/kepler'
import { computeOrbitWaypoints } from '../orbitMarkers'

const earthGm = 3.98600435436e14
const earthRadius = 6_371_000

describe('computeOrbitWaypoints', () => {
  it('places periapsis and apoapsis along ±pHat for an elliptical orbit', () => {
    // Place ourselves at periapsis: r = a(1-e), v = sqrt(μ(1+e)/(a(1-e))) perp.
    const a = earthRadius + 1_000_000
    const e = 0.2
    const rp = a * (1 - e)
    const ra = a * (1 + e)
    const vp = Math.sqrt(earthGm * (1 + e) / (a * (1 - e)))
    const position: [number, number, number] = [rp, 0, 0]
    const velocity: [number, number, number] = [0, 0, vp]
    const elements = stateToElements(position, velocity, earthGm)
    const wp = computeOrbitWaypoints(elements, [0, 1, 0])

    expect(wp.periapsis).not.toBeNull()
    expect(wp.apoapsis).not.toBeNull()
    expect(wp.periapsis!.anomaly).toBeCloseTo(0)
    expect(wp.apoapsis!.anomaly).toBeCloseTo(Math.PI)
    expect(Math.hypot(...wp.periapsis!.position)).toBeCloseTo(rp, 0)
    expect(Math.hypot(...wp.apoapsis!.position)).toBeCloseTo(ra, 0)
  })

  it('hides apsides for nearly-circular orbits', () => {
    const r = earthRadius + 400_000
    const position: [number, number, number] = [r, 0, 0]
    const velocity: [number, number, number] = [0, 0, Math.sqrt(earthGm / r)]
    const elements = stateToElements(position, velocity, earthGm)
    const wp = computeOrbitWaypoints(elements, [0, 1, 0])
    expect(wp.periapsis).toBeNull()
    expect(wp.apoapsis).toBeNull()
  })

  it('hides nodes for non-inclined orbits', () => {
    // Orbit in the xz-plane → orbit normal aligned with y. Reference axis also y → i=0.
    const r = earthRadius + 400_000
    const position: [number, number, number] = [r, 0, 0]
    const velocity: [number, number, number] = [0, 0, Math.sqrt(earthGm / r)]
    const elements = stateToElements(position, velocity, earthGm)
    const wp = computeOrbitWaypoints(elements, [0, 1, 0])
    expect(wp.ascendingNode).toBeNull()
    expect(wp.descendingNode).toBeNull()
  })

  it('finds AN/DN π apart with zero reference-axis component at both', () => {
    const r = earthRadius + 400_000
    const speed = Math.sqrt(earthGm / r)
    // 45-degree inclination — velocity tilted up out of the equator.
    const position: [number, number, number] = [r, 0, 0]
    const velocity: [number, number, number] = [
      0,
      speed * Math.sin(Math.PI / 4),
      speed * Math.cos(Math.PI / 4),
    ]
    const elements = stateToElements(position, velocity, earthGm)
    const wp = computeOrbitWaypoints(elements, [0, 1, 0])

    expect(wp.ascendingNode).not.toBeNull()
    expect(wp.descendingNode).not.toBeNull()
    // Both nodes lie in the reference plane → y-component ≈ 0.
    expect(wp.ascendingNode!.position[1]).toBeCloseTo(0, 4)
    expect(wp.descendingNode!.position[1]).toBeCloseTo(0, 4)
    // They are π apart in anomaly.
    const twoPi = 2 * Math.PI
    const delta = ((wp.descendingNode!.anomaly - wp.ascendingNode!.anomaly) % twoPi + twoPi) % twoPi
    expect(delta).toBeCloseTo(Math.PI, 4)
  })

  it('hides apsides on hyperbolic / open orbits', () => {
    const position: [number, number, number] = [earthRadius + 400_000, 0, 0]
    const velocity: [number, number, number] = [0, 0, 15_000]
    const elements = stateToElements(position, velocity, earthGm)
    const wp = computeOrbitWaypoints(elements, [0, 1, 0])
    expect(wp.periapsis).toBeNull()
    expect(wp.apoapsis).toBeNull()
  })
})
