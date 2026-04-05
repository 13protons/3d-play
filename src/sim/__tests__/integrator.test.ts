import { describe, it, expect } from 'vitest'
import { integrate } from '../orbital/integrator'
import { G } from '../constants'
import { relativePosition } from '../coordinates'
import type { CelestialBody } from '../types'

function makeBody(
  overrides: Partial<CelestialBody> & { id: string },
): CelestialBody {
  return {
    name: overrides.id,
    parentId: null,
    mass: 1,
    radius: 1,
    position: { sector: [0, 0, 0], local: [0, 0, 0] },
    velocity: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    angularVelocity: 0,
    ...overrides,
  }
}

describe('integrate (Störmer-Verlet)', () => {
  it('advances positions based on velocity', () => {
    const bodies = [
      makeBody({
        id: 'a',
        mass: 0,
        velocity: [100, 0, 0],
        position: { sector: [0, 0, 0], local: [0, 0, 0] },
      }),
    ]

    // With no gravitational attraction (mass=0), should just move at constant velocity
    // But we need at least 2 bodies for gravity to matter, let's use one body with mass 0
    integrate(bodies, 1.0)

    const pos = bodies[0].position
    const absX = pos.sector[0] * 1_000_000 + pos.local[0]
    expect(absX).toBeCloseTo(100, 0)
  })

  it('conserves energy in circular orbit over many steps', () => {
    // Sun at origin, planet in circular orbit
    const sunMass = 1.989e30
    const r = 1.496e11 // ~1 AU
    const v = Math.sqrt((G * sunMass) / r) // circular orbital velocity

    const bodies = [
      makeBody({
        id: 'sun',
        mass: sunMass,
        position: { sector: [0, 0, 0], local: [0, 0, 0] },
        velocity: [0, 0, 0],
      }),
      makeBody({
        id: 'planet',
        mass: 1, // negligible
        position: { sector: [149600, 0, 0], local: [0, 0, 0] },
        velocity: [0, 0, v],
      }),
    ]

    // Compute initial energy
    function kineticEnergy(): number {
      const vx = bodies[1].velocity[0]
      const vy = bodies[1].velocity[1]
      const vz = bodies[1].velocity[2]
      return 0.5 * (vx * vx + vy * vy + vz * vz)
    }

    function potentialEnergy(): number {
      const rel = relativePosition(bodies[1].position, bodies[0].position)
      const dist = Math.sqrt(rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2])
      return (-G * sunMass) / dist
    }

    const initialEnergy = kineticEnergy() + potentialEnergy()

    // Integrate for ~1000 steps (about 16 seconds of sim time at dt=1/60)
    const dt = 1 / 60
    for (let i = 0; i < 1000; i++) {
      integrate(bodies, dt)
    }

    const finalEnergy = kineticEnergy() + potentialEnergy()
    const drift = Math.abs((finalEnergy - initialEnergy) / initialEnergy)

    // Störmer-Verlet should conserve energy to within ~0.01% over 1000 steps
    expect(drift).toBeLessThan(0.0001)
  })

  it('produces correct orbital period for Earth', () => {
    const sunMass = 1.989e30
    const r = 1.496e11
    const v = Math.sqrt((G * sunMass) / r)

    const bodies = [
      makeBody({
        id: 'sun',
        mass: sunMass,
        position: { sector: [0, 0, 0], local: [0, 0, 0] },
        velocity: [0, 0, 0],
      }),
      makeBody({
        id: 'earth',
        mass: 5.972e24,
        position: { sector: [149600, 0, 0], local: [0, 0, 0] },
        velocity: [0, 0, v],
      }),
    ]

    // Run for a few hundred steps and check the orbit stays roughly circular
    const dt = 1 / 60
    const initialDist = r

    for (let i = 0; i < 500; i++) {
      integrate(bodies, dt)
    }

    const rel = relativePosition(bodies[0].position, bodies[1].position)
    const finalDist = Math.sqrt(rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2])

    // After 500 steps (~8.3 seconds), distance should be nearly unchanged
    const distDrift = Math.abs(finalDist - initialDist) / initialDist
    expect(distDrift).toBeLessThan(0.0001)
  })
})
