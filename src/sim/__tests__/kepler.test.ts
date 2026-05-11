import { describe, it, expect } from 'vitest'
import { stateToElements, sampleOrbit, sampleOrbitAtTrueAnomalies } from '../orbital/kepler'
import { G } from '../constants'

const sunMass = 1.989e30
const sunGm = G * sunMass
const earthOrbitRadius = 1.496e11
const earthOrbitalSpeed = Math.sqrt(sunGm / earthOrbitRadius)

describe('stateToElements', () => {
  it('uses the supplied parent GM directly', () => {
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const v: [number, number, number] = [0, 0, earthOrbitalSpeed]

    const elements = stateToElements(r, v, sunGm)

    expect(elements.mu).toBe(sunGm)
  })

  it('computes near-zero eccentricity for circular orbit', () => {
    // Earth-like circular orbit in xz plane (y-up)
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const v: [number, number, number] = [0, 0, earthOrbitalSpeed]

    const elements = stateToElements(r, v, sunGm)

    expect(elements.e).toBeLessThan(0.01)
    expect(elements.a).toBeCloseTo(earthOrbitRadius, -5) // within 100km
  })

  it('computes correct semi-major axis', () => {
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const v: [number, number, number] = [0, 0, earthOrbitalSpeed]

    const elements = stateToElements(r, v, sunGm)

    // a should be ~1 AU
    const relError = Math.abs(elements.a - earthOrbitRadius) / earthOrbitRadius
    expect(relError).toBeLessThan(0.001)
  })

  it('detects eccentric orbit', () => {
    // Start at periapsis with 20% more speed than circular
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const v: [number, number, number] = [0, 0, earthOrbitalSpeed * 1.2]

    const elements = stateToElements(r, v, sunGm)

    expect(elements.e).toBeGreaterThan(0.1)
    expect(elements.a).toBeGreaterThan(earthOrbitRadius) // larger orbit
  })

  it('computes inclination for tilted orbit', () => {
    // Orbit tilted 30° from xz plane (y-up means 30° inclination)
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const cos30 = Math.cos(Math.PI / 6)
    const sin30 = Math.sin(Math.PI / 6)
    // Negative z so angular momentum has positive y-component (prograde)
    const v: [number, number, number] = [
      0,
      earthOrbitalSpeed * sin30,
      -earthOrbitalSpeed * cos30,
    ]

    const elements = stateToElements(r, v, sunGm)

    // Inclination should be ~30° = ~0.524 radians
    expect(elements.i).toBeCloseTo(Math.PI / 6, 1)
  })

  it('reconstructs the current position at the returned true anomaly', () => {
    const r: [number, number, number] = [earthOrbitRadius, earthOrbitRadius * 0.12, earthOrbitRadius * 0.35]
    const v: [number, number, number] = [-2200, 3600, earthOrbitalSpeed * 0.92]

    const elements = stateToElements(r, v, sunGm)
    const [reconstructed] = sampleOrbitAtTrueAnomalies(elements, [elements.ta])
    const error = Math.hypot(
      reconstructed[0] - r[0],
      reconstructed[1] - r[1],
      reconstructed[2] - r[2],
    )

    expect(error / Math.hypot(...r)).toBeLessThan(1e-9)
  })
})

describe('sampleOrbit', () => {
  it('returns correct number of points for elliptical orbit', () => {
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const v: [number, number, number] = [0, 0, earthOrbitalSpeed]
    const elements = stateToElements(r, v, sunGm)

    const points = sampleOrbit(elements, 64)
    expect(points.length).toBe(65) // 64 segments = 65 points (closed)
  })

  it('returns empty for hyperbolic orbit', () => {
    // Escape velocity = sqrt(2) * circular velocity
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const v: [number, number, number] = [0, 0, earthOrbitalSpeed * 2]
    const elements = stateToElements(r, v, sunGm)

    expect(elements.e).toBeGreaterThan(1)
    const points = sampleOrbit(elements, 64)
    expect(points.length).toBe(0)
  })

  it('orbit points lie at approximately correct distance for circular orbit', () => {
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const v: [number, number, number] = [0, 0, earthOrbitalSpeed]
    const elements = stateToElements(r, v, sunGm)
    const points = sampleOrbit(elements, 64)

    for (const p of points) {
      const dist = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2])
      const relError = Math.abs(dist - earthOrbitRadius) / earthOrbitRadius
      expect(relError).toBeLessThan(0.01) // within 1% for near-circular
    }
  })

  it('orbit points form a closed loop', () => {
    const r: [number, number, number] = [earthOrbitRadius, 0, 0]
    const v: [number, number, number] = [0, 0, earthOrbitalSpeed]
    const elements = stateToElements(r, v, sunGm)
    const points = sampleOrbit(elements, 64)

    const first = points[0]
    const last = points[points.length - 1]
    const dist = Math.sqrt(
      (first[0] - last[0]) ** 2 +
      (first[1] - last[1]) ** 2 +
      (first[2] - last[2]) ** 2,
    )
    // Should close back to start
    expect(dist / earthOrbitRadius).toBeLessThan(0.001)
  })
})
