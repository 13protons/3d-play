import { describe, expect, it } from 'vitest'
import { predictVehicleOrbit } from '../orbital/vehiclePrediction'

const earthGm = 3.98600435436e14
const moonGm = 4.902800066e12
const earthRadius = 6_371_000
const earthSoi = 929_000_000

const earth = {
  id: 'earth',
  gm: earthGm,
  radius: earthRadius,
  soiRadius: earthSoi,
  position: [0, 0, 0] as [number, number, number],
  velocity: [0, 0, 0] as [number, number, number],
}

describe('predictVehicleOrbit', () => {
  it('samples one closed local orbit around the parent body', () => {
    const altitude = 400_000
    const radius = earthRadius + altitude
    const circularSpeed = Math.sqrt(earthGm / radius)

    const prediction = predictVehicleOrbit({
      vehicle: {
        position: [radius, 0, 0],
        velocity: [0, 0, circularSpeed],
      },
      parent: earth,
      bodies: [earth],
    })

    expect(prediction.status).toBe('ok')
    expect(prediction.points.length).toBeGreaterThan(100)
    expect(prediction.period).toBeGreaterThan(5_000)
    expect(prediction.parentId).toBe('earth')
    expect(prediction.warnings).toEqual([])
  })

  it('classifies hyperbolic trajectories as escape', () => {
    const radius = earthRadius + 400_000
    const escapeSpeed = Math.sqrt((2 * earthGm) / radius)

    const prediction = predictVehicleOrbit({
      vehicle: {
        position: [radius, 0, 0],
        velocity: [0, 0, escapeSpeed * 1.01],
      },
      parent: earth,
      bodies: [earth],
    })

    expect(prediction.status).toBe('escape')
    expect(prediction.points.length).toBeGreaterThan(10)
    expect(prediction.warnings).toContain('hyperbolic-or-parabolic')
  })

  it('bounds hyperbolic escape arcs near the parent SOI', () => {
    const radius = earthRadius + 400_000
    const escapeSpeed = Math.sqrt((2 * earthGm) / radius)

    const prediction = predictVehicleOrbit({
      vehicle: {
        position: [radius, 0, 0],
        velocity: [0, 0, escapeSpeed * 1.01],
      },
      parent: earth,
      bodies: [earth],
    })

    const maxDistance = Math.max(
      ...prediction.points.map((point) => Math.hypot(point[0], point[1], point[2])),
    )
    expect(maxDistance).toBeLessThanOrEqual(earthSoi * 1.01)
  })

  it('classifies closed orbits with apoapsis beyond the parent SOI as escape', () => {
    const radius = earthRadius + 400_000
    const highEllipticSpeed = Math.sqrt(
      earthGm * (2 / radius - 1 / ((radius + earthSoi * 1.2) / 2)),
    )

    const prediction = predictVehicleOrbit({
      vehicle: {
        position: [radius, 0, 0],
        velocity: [0, 0, highEllipticSpeed],
      },
      parent: earth,
      bodies: [earth],
    })

    expect(prediction.status).toBe('escape')
    expect(prediction.warnings).toContain('apoapsis-exceeds-parent-soi')
  })

  it('classifies a local orbit that enters another body influence region as encounter', () => {
    const vehicleRadius = 8_000_000
    const circularSpeed = Math.sqrt(earthGm / vehicleRadius)
    const moonLikeBody = {
      id: 'moon',
      gm: moonGm,
      radius: 1_737_000,
      soiRadius: 80_000,
      position: [vehicleRadius, 40_000, 0] as [number, number, number],
      velocity: [0, 0, 0] as [number, number, number],
    }

    const prediction = predictVehicleOrbit({
      vehicle: {
        position: [vehicleRadius, 0, 0],
        velocity: [0, 0, circularSpeed],
      },
      parent: earth,
      bodies: [earth, moonLikeBody],
    })

    expect(prediction.status).toBe('encounter')
    expect(prediction.encounterBodyId).toBe('moon')
    expect(prediction.warnings).toContain('encounter:moon')
  })

  it('classifies strongly perturbed orbits when non-parent gravity is significant', () => {
    const vehicleRadius = 20_000_000
    const circularSpeed = Math.sqrt(earthGm / vehicleRadius)
    const perturbingBody = {
      id: 'heavy-neighbor',
      gm: earthGm * 0.2,
      radius: 1_000_000,
      soiRadius: 0,
      position: [vehicleRadius, 50_000_000, 0] as [number, number, number],
      velocity: [0, 0, 0] as [number, number, number],
    }

    const prediction = predictVehicleOrbit({
      vehicle: {
        position: [vehicleRadius, 0, 0],
        velocity: [0, 0, circularSpeed],
      },
      parent: earth,
      bodies: [earth, perturbingBody],
    })

    expect(prediction.status).toBe('strong-perturbation')
    expect(prediction.perturbingBodyId).toBe('heavy-neighbor')
    expect(prediction.warnings).toContain('strong-perturbation:heavy-neighbor')
  })
})
