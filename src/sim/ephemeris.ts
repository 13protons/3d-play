import { SECTOR_SIZE } from './constants'
import type { SectorPosition } from './types'

export interface EphemerisStateVector {
  id: string
  position: [number, number, number]
  velocity: [number, number, number]
}

export function jplEclipticToAppYUpVector(
  vector: [number, number, number],
): [number, number, number] {
  return [vector[0], -vector[2], vector[1]]
}

export function toSectorPosition(valueMeters: number): { sector: number; local: number } {
  const sector = Math.floor(valueMeters / SECTOR_SIZE)
  return { sector, local: valueMeters - sector * SECTOR_SIZE }
}

export function vectorToSectorPosition(
  position: [number, number, number],
): SectorPosition {
  const x = toSectorPosition(position[0])
  const y = toSectorPosition(position[1])
  const z = toSectorPosition(position[2])
  return {
    sector: [x.sector, y.sector, z.sector],
    local: [x.local, y.local, z.local],
  }
}

export function packStateVectors(vectors: EphemerisStateVector[]): Float64Array {
  const state = new Float64Array(vectors.length * 6)
  for (let i = 0; i < vectors.length; i++) {
    const offset = i * 6
    const vector = vectors[i]
    state[offset] = vector.position[0]
    state[offset + 1] = vector.position[1]
    state[offset + 2] = vector.position[2]
    state[offset + 3] = vector.velocity[0]
    state[offset + 4] = vector.velocity[1]
    state[offset + 5] = vector.velocity[2]
  }
  return state
}
