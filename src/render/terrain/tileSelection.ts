import type { TerrainCubeFace, TerrainTileId, Vec3 } from './types'
import { clampTerrainTileY, terrainTileColumnCount } from './tileId'
import { tileLodForCameraDistance } from './terrainLodPolicy'

const CUBE_FACES: TerrainCubeFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz']

export function selectCubeSphereShellTiles({
  bodyId,
  lod,
}: {
  bodyId: string
  lod: number
}): TerrainTileId[] {
  const count = terrainTileColumnCount(lod)
  const tiles: TerrainTileId[] = []
  for (const face of CUBE_FACES) {
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        tiles.push({ bodyId, face, lod, x, y })
      }
    }
  }
  return tiles
}

export function selectTerrainTiles({
  bodyId,
  bodyRadius,
  cameraDistance,
  focusDirection,
  overscan,
}: {
  bodyId: string
  bodyRadius: number
  cameraDistance: number
  focusDirection: Vec3
  overscan: number
}): TerrainTileId[] {
  const lod = tileLodForCameraDistance({ cameraDistance, bodyRadius })
  const count = terrainTileColumnCount(lod)
  const facePosition = directionToCubeFacePosition(focusDirection)
  const centerX = Math.floor(facePosition.u * count)
  const centerY = Math.floor(facePosition.v * count)
  const tiles: TerrainTileId[] = []
  const seen = new Set<string>()

  for (let dy = -overscan; dy <= overscan; dy++) {
    for (let dx = -overscan; dx <= overscan; dx++) {
      const x = clampTerrainTileY(centerX + dx, lod)
      const y = clampTerrainTileY(centerY + dy, lod)
      const key = `${x}:${y}`
      if (seen.has(key)) continue
      seen.add(key)
      tiles.push({ bodyId, face: facePosition.face, lod, x, y })
    }
  }

  return tiles
}

export function directionToCubeFacePosition(direction: Vec3): {
  face: TerrainCubeFace
  u: number
  v: number
} {
  const normalized = normalize(direction, [1, 0, 0])
  const [x, y, z] = normalized
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  if (ax >= ay && ax >= az) {
    return x >= 0
      ? { face: 'px', u: clamp01((-z / ax + 1) * 0.5), v: clamp01((-y / ax + 1) * 0.5) }
      : { face: 'nx', u: clamp01((z / ax + 1) * 0.5), v: clamp01((-y / ax + 1) * 0.5) }
  }
  if (ay >= ax && ay >= az) {
    return y >= 0
      ? { face: 'py', u: clamp01((x / ay + 1) * 0.5), v: clamp01((z / ay + 1) * 0.5) }
      : { face: 'ny', u: clamp01((x / ay + 1) * 0.5), v: clamp01((-z / ay + 1) * 0.5) }
  }
  return z >= 0
    ? { face: 'pz', u: clamp01((x / az + 1) * 0.5), v: clamp01((-y / az + 1) * 0.5) }
    : { face: 'nz', u: clamp01((-x / az + 1) * 0.5), v: clamp01((-y / az + 1) * 0.5) }
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2])
  if (!Number.isFinite(magnitude) || magnitude <= 0) return fallback
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
