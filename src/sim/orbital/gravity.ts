import { G, SECTOR_SIZE } from '../constants'
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

/** Compute gravitational acceleration at an arbitrary absolute point from all bodies. */
export function gravityAtPoint(
  bodies: CelestialBody[],
  point: [number, number, number],
): [number, number, number] {
  const acc: [number, number, number] = [0, 0, 0]
  for (const body of bodies) {
    const bx = body.position.sector[0] * SECTOR_SIZE + body.position.local[0]
    const by = body.position.sector[1] * SECTOR_SIZE + body.position.local[1]
    const bz = body.position.sector[2] * SECTOR_SIZE + body.position.local[2]
    const dx = bx - point[0]
    const dy = by - point[1]
    const dz = bz - point[2]
    const r2 = dx * dx + dy * dy + dz * dz
    const r = Math.sqrt(r2)
    if (r < 1) continue
    const f = (G * body.mass) / (r2 * r)
    acc[0] += f * dx
    acc[1] += f * dy
    acc[2] += f * dz
  }
  return acc
}
