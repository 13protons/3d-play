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
  it('does not draw a degenerate prediction for zero relative velocity', () => {
    const prediction = predictVehicleOrbit({
      vehicle: {
        position: [earthRadius, 0, 0],
        velocity: [0, 0, 0],
      },
      parent: earth,
      bodies: [earth],
    })

    expect(prediction.status).toBe('invalid')
    expect(prediction.points).toEqual([])
  })

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

  it('adds focused samples near the vehicle so low-altitude predictions stay curved', () => {
    const altitude = 1_800
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

    expect(prediction.points.length).toBeGreaterThan(240)
  })

  it('adds extra samples for highly elliptical orbits with sharp apsis turns', () => {
    const periapsisRadius = earthRadius + 1_800
    const apoapsisRadius = earthRadius + 5_000_000
    const semiMajorAxis = (periapsisRadius + apoapsisRadius) / 2
    const periapsisSpeed = Math.sqrt(earthGm * (2 / periapsisRadius - 1 / semiMajorAxis))
    const circularSpeed = Math.sqrt(earthGm / periapsisRadius)

    const circular = predictVehicleOrbit({
      vehicle: {
        position: [periapsisRadius, 0, 0],
        velocity: [0, 0, circularSpeed],
      },
      parent: earth,
      bodies: [earth],
    })
    const elliptical = predictVehicleOrbit({
      vehicle: {
        position: [periapsisRadius, 0, 0],
        velocity: [0, 0, periapsisSpeed],
      },
      parent: earth,
      bodies: [earth],
    })

    expect(elliptical.points.length).toBeGreaterThan(circular.points.length)
  })

  it('clips impact predictions to the above-surface arc and spends samples there', () => {
    const currentRadius = earthRadius + 10_000
    const apoapsisRadius = earthRadius + 12_000
    const periapsisRadius = earthRadius - 6_300_000
    const semiMajorAxis = (periapsisRadius + apoapsisRadius) / 2
    const currentSpeed = Math.sqrt(earthGm * (2 / currentRadius - 1 / semiMajorAxis))

    const prediction = predictVehicleOrbit({
      vehicle: {
        position: [currentRadius, 0, 0],
        velocity: [0, 0, currentSpeed],
      },
      parent: earth,
      bodies: [earth],
    })

    expect(prediction.points.length).toBeGreaterThan(180)
    expect(prediction.points.every((point) => Math.hypot(...point) >= earthRadius - 1)).toBe(true)
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
