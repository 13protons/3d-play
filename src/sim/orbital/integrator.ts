import type { CelestialBody } from '../types'
import { normalize } from '../coordinates'
import { gravitationalAcceleration } from './gravity'

/**
 * Advance all bodies by one timestep using Störmer-Verlet (leapfrog) integration.
 * Symplectic — conserves energy over long timescales, keeping orbits stable.
 */
export function integrate(bodies: CelestialBody[], dt: number): void {
  const halfDt = dt * 0.5

  // Half-step velocity update
  const acc1 = bodies.map((_, i) => gravitationalAcceleration(bodies, i))
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i]
    body.velocity[0] += acc1[i][0] * halfDt
    body.velocity[1] += acc1[i][1] * halfDt
    body.velocity[2] += acc1[i][2] * halfDt
  }

  // Full-step position update
  for (const body of bodies) {
    body.position.local[0] += body.velocity[0] * dt
    body.position.local[1] += body.velocity[1] * dt
    body.position.local[2] += body.velocity[2] * dt
    body.position = normalize(body.position)
  }

  // Second half-step velocity update (with new positions)
  const acc2 = bodies.map((_, i) => gravitationalAcceleration(bodies, i))
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i]
    body.velocity[0] += acc2[i][0] * halfDt
    body.velocity[1] += acc2[i][1] * halfDt
    body.velocity[2] += acc2[i][2] * halfDt
  }
}
