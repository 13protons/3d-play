import { G } from '../constants'
import { relativePosition } from '../coordinates'
import type { CelestialBody } from '../types'

/** Compute gravitational acceleration on bodies[index] from all other bodies. */
export function gravitationalAcceleration(
  bodies: CelestialBody[],
  index: number,
): [number, number, number] {
  const acc: [number, number, number] = [0, 0, 0]
  const body = bodies[index]

  for (let j = 0; j < bodies.length; j++) {
    if (j === index) continue

    const rel = relativePosition(body.position, bodies[j].position)
    const r2 = rel[0] * rel[0] + rel[1] * rel[1] + rel[2] * rel[2]
    const r = Math.sqrt(r2)

    if (r < 1) continue // avoid singularity

    const f = (G * bodies[j].mass) / (r2 * r)
    acc[0] += f * rel[0]
    acc[1] += f * rel[1]
    acc[2] += f * rel[2]
  }

  return acc
}
