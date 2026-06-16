import { describe, it, expect } from 'vitest'
import { nBodyDerivatives, nBodyDerivativesFromGMs, pointMassDerivatives } from '../integrator/derivatives'
import { G } from '../constants'
import type { TrajectoryCurve } from '../types'

describe('nBodyDerivatives', () => {
  it('computes correct acceleration for two-body system', () => {
    const masses = [5.972e24, 1.989e30] // Earth, Sun
    const deriv = nBodyDerivatives(masses)

    // Earth at (1.5e11, 0, 0), Sun at origin. Both at rest.
    const y = new Float64Array([
      1.496e11, 0, 0, 0, 0, 0,  // Earth: pos + vel
      0, 0, 0, 0, 0, 0,          // Sun: pos + vel
    ])
    const dydt = new Float64Array(12)
    deriv(0, y, dydt)

    // Earth velocity derivatives = Earth velocity (from state)
    expect(dydt[0]).toBe(0) // dx/dt = vx = 0
    // Earth acceleration: toward Sun (negative x)
    expect(dydt[3]).toBeLessThan(0)
    const expectedAcc = G * 1.989e30 / (1.496e11) ** 2
    expect(Math.abs(dydt[3])).toBeCloseTo(expectedAcc, 5)

    // Newton's third law: Sun acceleration should be equal and opposite (scaled by mass ratio)
    const expectedSunAcc = G * 5.972e24 / (1.496e11) ** 2
    expect(dydt[9]).toBeGreaterThan(0) // Sun accelerates toward Earth (+x)
    expect(Math.abs(dydt[9])).toBeCloseTo(expectedSunAcc, 5)
  })

  it('computes acceleration directly from GM values', () => {
    const earthGM = 398600.435436e9
    const sunGM = 1.3271244004193939e20
    const deriv = nBodyDerivativesFromGMs([earthGM, sunGM])

    const y = new Float64Array([
      1.496e11, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ])
    const dydt = new Float64Array(12)
    deriv(0, y, dydt)

    expect(Math.abs(dydt[3])).toBeCloseTo(sunGM / (1.496e11) ** 2, 5)
    expect(Math.abs(dydt[9])).toBeCloseTo(earthGM / (1.496e11) ** 2, 5)
  })
})

describe('pointMassDerivatives', () => {
  it('computes gravity from body curves at interpolated time', () => {
    // A body at x=0 with zero velocity (stationary)
    const bodyCurves: TrajectoryCurve[] = [{
      id: 'earth', parentId: '',
      p0: [0, 0, 0], v0: [0, 0, 0], t0: 0,
      p1: [0, 0, 0], v1: [0, 0, 0], t1: 100,
    }]
    const masses = new Map([['earth', G * 5.972e24]])
    const deriv = pointMassDerivatives(bodyCurves, masses)

    // Vehicle at (6.771e6, 0, 0)
    const y = new Float64Array([6_771_000, 0, 0, 0, 0, 7670])
    const dydt = new Float64Array(6)
    deriv(0, y, dydt)

    // Velocity derivatives = velocity
    expect(dydt[0]).toBe(0)
    expect(dydt[2]).toBe(7670)
    // Acceleration toward Earth (negative x)
    expect(dydt[3]).toBeLessThan(0)
    const expectedAcc = G * 5.972e24 / 6_771_000 ** 2
    expect(Math.abs(dydt[3])).toBeCloseTo(expectedAcc, 5)
  })

  it('interpolates body position from curves at mid-time', () => {
    // Body moving from (0,0,0) to (1000,0,0) over 10 seconds
    const bodyCurves: TrajectoryCurve[] = [{
      id: 'mover', parentId: '',
      p0: [0, 0, 0], v0: [100, 0, 0], t0: 0,
      p1: [1000, 0, 0], v1: [100, 0, 0], t1: 10,
    }]
    const masses = new Map([['mover', G * 1e24]])
    const deriv = pointMassDerivatives(bodyCurves, masses)

    // Vehicle far away at (1e9, 0, 0), evaluate at t=5
    // Body should be at approximately (500, 0, 0) at t=5
    const y = new Float64Array([1e9, 0, 0, 0, 0, 0])
    const dydt = new Float64Array(6)
    deriv(5, y, dydt)

    // Acceleration should point in -x direction (toward body at ~500)
    expect(dydt[3]).toBeLessThan(0)
  })

  it('silently skips curves with no matching GM entry', () => {
    const bodyCurves: TrajectoryCurve[] = [{
      id: 'unknown-body', parentId: '',
      p0: [0, 0, 0], v0: [0, 0, 0], t0: 0,
      p1: [0, 0, 0], v1: [0, 0, 0], t1: 100,
    }]
    // No matching entry in the GM map
    const masses = new Map<string, number>()
    const deriv = pointMassDerivatives(bodyCurves, masses)

    const y = new Float64Array([6_771_000, 0, 0, 0, 0, 7670])
    const dydt = new Float64Array(6)
    deriv(0, y, dydt)

    // No gravity — only velocity derivatives
    expect(dydt[0]).toBe(0)
    expect(dydt[2]).toBe(7670)
    expect(dydt[3]).toBe(0)
    expect(dydt[4]).toBe(0)
    expect(dydt[5]).toBe(0)
  })
})
