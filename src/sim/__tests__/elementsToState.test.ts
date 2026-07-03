import { describe, it, expect } from 'vitest'
import { stateToElements, stateToElementVector, elementsToState } from '../orbital/kepler'
import { G } from '../constants'

const earthGm = G * 5.972e24
type Vec3 = [number, number, number]

function expectVecClose(actual: Vec3, expected: Vec3, relTol = 1e-6) {
  const scale = Math.max(Math.hypot(...expected), 1)
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i] - expected[i]) / scale).toBeLessThan(relTol)
  }
}

describe('elementsToState', () => {
  // Round-trip: state -> elements -> state must recover the original, which
  // proves the forward transform is a true inverse independent of how the angle
  // conventions are derived.
  const cases: Array<{ name: string; r: Vec3; v: Vec3 }> = [
    {
      name: 'circular equatorial',
      r: [6_771_000, 0, 0],
      v: [0, 0, Math.sqrt(earthGm / 6_771_000)],
    },
    {
      name: 'inclined eccentric',
      r: [7_000_000, 1_200_000, -500_000],
      v: [-300, 6800, 4200],
    },
    {
      name: 'retrograde-ish high inclination',
      r: [0, 6_771_000, 1_000_000],
      v: [7600, 100, -200],
    },
    {
      name: 'eccentric polar',
      r: [8_000_000, 0, 0],
      v: [0, 7000, 1500],
    },
  ]

  for (const { name, r, v } of cases) {
    it(`round-trips ${name}`, () => {
      const el = stateToElements(r, v, earthGm)
      const back = elementsToState(el)
      expectVecClose(back.position, r)
      expectVecClose(back.velocity, v)
    })
  }

  // The lossless inverse must round-trip even the degenerate orbits where
  // classic element extraction loses the node/periapsis azimuth.
  const inverseCases: Array<{ name: string; r: Vec3; v: Vec3 }> = [
    ...cases,
    { name: 'circular equatorial +x', r: [6_771_000, 0, 0], v: [0, 0, Math.sqrt(earthGm / 6_771_000)] },
    { name: 'circular equatorial -x', r: [-6_771_000, 0, 0], v: [0, 0, Math.sqrt(earthGm / 6_771_000)] },
    { name: 'circular equatorial +z', r: [0, 0, 6_771_000], v: [Math.sqrt(earthGm / 6_771_000), 0, 0] },
  ]
  for (const { name, r, v } of inverseCases) {
    it(`stateToElementVector losslessly round-trips ${name}`, () => {
      const el = stateToElementVector(r, v, earthGm)
      expect(el).not.toBeNull()
      const back = elementsToState(el!)
      expectVecClose(back.position, r, 1e-5)
      expectVecClose(back.velocity, v, 1e-5)
    })
  }

  it('returns null for an at-rest (non-orbital) state', () => {
    expect(stateToElementVector([6_771_000, 0, 0], [0, 0, 0], earthGm)).toBeNull()
  })

  it('builds a circular orbit of the requested radius and speed', () => {
    const radius = 6_771_000
    const { position, velocity } = elementsToState({
      a: radius,
      e: 0,
      i: 0,
      lan: 0,
      aop: 0,
      ta: 0,
      mu: earthGm,
    })
    expect(Math.hypot(...position)).toBeCloseTo(radius, -2)
    expect(Math.hypot(...velocity)).toBeCloseTo(Math.sqrt(earthGm / radius), 0)
    // Circular orbit: velocity is perpendicular to position.
    const dot = position[0] * velocity[0] + position[1] * velocity[1] + position[2] * velocity[2]
    expect(Math.abs(dot) / (Math.hypot(...position) * Math.hypot(...velocity))).toBeLessThan(1e-9)
  })
})
