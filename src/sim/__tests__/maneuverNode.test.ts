import { describe, expect, it } from 'vitest'
import { stateToElements } from '../orbital/kepler'
import {
  anomalyAtTime,
  applyManeuverDeltaV,
  meanAnomalyFromTrue,
  nearestAnomalyToPoint,
  stateAtAnomaly,
  timeAtAnomaly,
} from '../maneuverNode'

const earthGm = 3.98600435436e14
const earthRadius = 6_371_000

function circularOrbit(altitude: number) {
  const r = earthRadius + altitude
  const v = Math.sqrt(earthGm / r)
  const position: [number, number, number] = [r, 0, 0]
  const velocity: [number, number, number] = [0, 0, v]
  const elements = stateToElements(position, velocity, earthGm)
  return { position, velocity, elements }
}

describe('meanAnomalyFromTrue', () => {
  it('maps ν=0 (periapsis) to M=0', () => {
    expect(meanAnomalyFromTrue(0, 0.3)).toBeCloseTo(0)
  })

  it('maps ν=π (apoapsis) to M=π', () => {
    expect(meanAnomalyFromTrue(Math.PI, 0.4)).toBeCloseTo(Math.PI)
  })

  it('reduces to ν for a circular orbit (e=0)', () => {
    const trueAnomaly = 1.2345
    expect(meanAnomalyFromTrue(trueAnomaly, 0)).toBeCloseTo(trueAnomaly)
  })
})

describe('timeAtAnomaly', () => {
  it('quarter-period for a +π/2 step in circular orbit', () => {
    const { elements } = circularOrbit(400_000)
    const period = 2 * Math.PI * Math.sqrt(elements.a ** 3 / elements.mu)
    const targetAnomaly = elements.ta + Math.PI / 2
    const tNode = timeAtAnomaly(elements, 1000, targetAnomaly)
    expect(tNode).not.toBeNull()
    expect(tNode! - 1000).toBeCloseTo(period / 4, 1)
  })

  it('wraps to the next revolution when target is the current anomaly', () => {
    const { elements } = circularOrbit(400_000)
    const period = 2 * Math.PI * Math.sqrt(elements.a ** 3 / elements.mu)
    const tNode = timeAtAnomaly(elements, 0, elements.ta)
    expect(tNode).not.toBeNull()
    expect(tNode!).toBeCloseTo(period, 1)
  })

  it('returns null for hyperbolic orbits', () => {
    const position: [number, number, number] = [earthRadius + 400_000, 0, 0]
    const velocity: [number, number, number] = [0, 0, 15_000]
    const elements = stateToElements(position, velocity, earthGm)
    expect(timeAtAnomaly(elements, 0, 1.0)).toBeNull()
  })
})

describe('nearestAnomalyToPoint', () => {
  it('recovers the anomaly of a point lying exactly on the orbit', () => {
    const { elements } = circularOrbit(400_000)
    const targetAnomaly = elements.ta + Math.PI / 3
    const { position } = stateAtAnomaly(elements, targetAnomaly)
    const recovered = nearestAnomalyToPoint(elements, position)
    const twoPi = 2 * Math.PI
    const normalizedTarget = ((targetAnomaly % twoPi) + twoPi) % twoPi
    expect(recovered).toBeCloseTo(normalizedTarget, 4)
  })

  it('projects out-of-plane noise onto the orbital plane', () => {
    const { elements } = circularOrbit(400_000)
    const targetAnomaly = Math.PI / 4
    const { position } = stateAtAnomaly(elements, targetAnomaly)
    const noisy: [number, number, number] = [position[0], position[1] + 50_000, position[2]]
    expect(nearestAnomalyToPoint(elements, noisy)).toBeCloseTo(targetAnomaly, 3)
  })
})

describe('stateAtAnomaly', () => {
  it('reproduces the initial state at ν = ta', () => {
    const { position, velocity, elements } = circularOrbit(400_000)
    const state = stateAtAnomaly(elements, elements.ta)
    expect(state.position[0]).toBeCloseTo(position[0], 0)
    expect(state.position[1]).toBeCloseTo(position[1], 0)
    expect(state.position[2]).toBeCloseTo(position[2], 0)
    expect(state.velocity[0]).toBeCloseTo(velocity[0], 1)
    expect(state.velocity[1]).toBeCloseTo(velocity[1], 1)
    expect(state.velocity[2]).toBeCloseTo(velocity[2], 1)
  })

  it('places periapsis along pHat at ν=0', () => {
    const { elements } = circularOrbit(400_000)
    const state = stateAtAnomaly(elements, 0)
    const r = elements.a * (1 - elements.e)
    expect(state.position[0]).toBeCloseTo(elements.pHat[0] * r, 0)
    expect(state.position[1]).toBeCloseTo(elements.pHat[1] * r, 0)
    expect(state.position[2]).toBeCloseTo(elements.pHat[2] * r, 0)
  })
})

describe('anomalyAtTime', () => {
  it('round-trips with timeAtAnomaly', () => {
    const { elements } = circularOrbit(400_000)
    const target = elements.ta + 1.0
    const tNode = timeAtAnomaly(elements, 0, target)
    expect(tNode).not.toBeNull()
    const recovered = anomalyAtTime(elements, 0, tNode!)
    expect(recovered).not.toBeNull()
    const twoPi = 2 * Math.PI
    expect(((recovered! - target) % twoPi + twoPi) % twoPi).toBeLessThan(1e-6)
  })

  it('returns null for hyperbolic orbits', () => {
    const position: [number, number, number] = [earthRadius + 400_000, 0, 0]
    const velocity: [number, number, number] = [0, 0, 15_000]
    const elements = stateToElements(position, velocity, earthGm)
    expect(anomalyAtTime(elements, 0, 1000)).toBeNull()
  })
})

describe('applyManeuverDeltaV', () => {
  it('adds prograde deltaV along the velocity direction', () => {
    const state = {
      position: [earthRadius + 400_000, 0, 0] as [number, number, number],
      velocity: [0, 0, 7_700] as [number, number, number],
    }
    const newVelocity = applyManeuverDeltaV(state, { prograde: 100, normal: 0, radial: 0 })
    expect(newVelocity[0]).toBeCloseTo(0)
    expect(newVelocity[1]).toBeCloseTo(0)
    expect(newVelocity[2]).toBeCloseTo(7_800)
  })

  it('adds normal deltaV along the orbit-plane normal', () => {
    const state = {
      position: [earthRadius + 400_000, 0, 0] as [number, number, number],
      velocity: [0, 0, 7_700] as [number, number, number],
    }
    // r × v points in -y for this configuration.
    const newVelocity = applyManeuverDeltaV(state, { prograde: 0, normal: 100, radial: 0 })
    expect(newVelocity[0]).toBeCloseTo(0)
    expect(newVelocity[1]).toBeCloseTo(-100)
    expect(newVelocity[2]).toBeCloseTo(7_700)
  })

  it('returns the input velocity when speed is zero', () => {
    const state = {
      position: [earthRadius, 0, 0] as [number, number, number],
      velocity: [0, 0, 0] as [number, number, number],
    }
    expect(applyManeuverDeltaV(state, { prograde: 100, normal: 0, radial: 0 })).toEqual([0, 0, 0])
  })

  it('leaves orbit-plane unchanged for a pure prograde burn (energy increases)', () => {
    const { position, velocity, elements } = circularOrbit(400_000)
    const newVelocity = applyManeuverDeltaV({ position, velocity }, { prograde: 200, normal: 0, radial: 0 })
    const newElements = stateToElements(position, newVelocity, earthGm)
    // Inclination preserved; semi-major axis larger.
    expect(newElements.i).toBeCloseTo(elements.i, 4)
    expect(newElements.a).toBeGreaterThan(elements.a)
  })
})
