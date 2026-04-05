import { SECTOR_SIZE } from './constants'
import type { SectorPosition } from './types'

/** Normalize a SectorPosition so local offsets are in [0, SECTOR_SIZE). */
export function normalize(pos: SectorPosition): SectorPosition {
  const sector: [number, number, number] = [pos.sector[0], pos.sector[1], pos.sector[2]]
  const local: [number, number, number] = [pos.local[0], pos.local[1], pos.local[2]]

  for (let i = 0; i < 3; i++) {
    const overflow = Math.floor(local[i] / SECTOR_SIZE)
    sector[i] += overflow
    local[i] -= overflow * SECTOR_SIZE
  }

  return { sector, local }
}

/** Compute the float64 vector from `from` to `to`. Safe for nearby objects across sector boundaries. */
export function relativePosition(
  from: SectorPosition,
  to: SectorPosition,
): [number, number, number] {
  return [
    (to.sector[0] - from.sector[0]) * SECTOR_SIZE + (to.local[0] - from.local[0]),
    (to.sector[1] - from.sector[1]) * SECTOR_SIZE + (to.local[1] - from.local[1]),
    (to.sector[2] - from.sector[2]) * SECTOR_SIZE + (to.local[2] - from.local[2]),
  ]
}

/** Convert SectorPosition to a flat float64 vector (absolute coordinates). */
export function toAbsolute(pos: SectorPosition): [number, number, number] {
  return [
    pos.sector[0] * SECTOR_SIZE + pos.local[0],
    pos.sector[1] * SECTOR_SIZE + pos.local[1],
    pos.sector[2] * SECTOR_SIZE + pos.local[2],
  ]
}

/** Convert a SectorPosition to a camera-relative float64 vector for rendering. */
export function toRenderFrame(
  camera: SectorPosition,
  target: SectorPosition,
): [number, number, number] {
  return relativePosition(camera, target)
}
