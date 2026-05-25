import type { TerrainTileId } from './types'

export function terrainTileKey({ bodyId, face, lod, x, y }: TerrainTileId): string {
  return `${bodyId}:${face}:${lod}:${x}:${y}`
}

export function terrainTileColumnCount(lod: number): number {
  return 2 ** Math.max(0, lod)
}

export function wrapTerrainTileX(x: number, lod: number): number {
  const count = terrainTileColumnCount(lod)
  return ((x % count) + count) % count
}

export function clampTerrainTileY(y: number, lod: number): number {
  const count = terrainTileColumnCount(lod)
  return Math.min(count - 1, Math.max(0, y))
}

export function terrainTileChildren({ bodyId, face, lod, x, y }: TerrainTileId): TerrainTileId[] {
  const childLod = lod + 1
  return [
    { bodyId, face, lod: childLod, x: x * 2, y: y * 2 },
    { bodyId, face, lod: childLod, x: x * 2 + 1, y: y * 2 },
    { bodyId, face, lod: childLod, x: x * 2, y: y * 2 + 1 },
    { bodyId, face, lod: childLod, x: x * 2 + 1, y: y * 2 + 1 },
  ]
}
