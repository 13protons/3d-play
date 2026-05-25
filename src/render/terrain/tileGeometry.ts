import { BufferAttribute, BufferGeometry } from 'three'
import { terrainTileKey } from './tileId'
import type { TerrainTileData, TerrainTileId } from './types'

export function terrainTileSelectionKey(tileIds: TerrainTileId[]): string {
  return tileIds.map(terrainTileKey).join('|')
}

export function cachedTerrainTilesForIds({
  tileIds,
  getCachedTile,
}: {
  tileIds: TerrainTileId[]
  getCachedTile: (tileId: TerrainTileId) => TerrainTileData | undefined
}): TerrainTileData[] {
  const tiles: TerrainTileData[] = []
  for (const tileId of tileIds) {
    const tile = getCachedTile(tileId)
    if (tile) tiles.push(tile)
  }
  return tiles
}

export function mergeTerrainTileData(tiles: TerrainTileData[]): TerrainTileData {
  let firstTile: TerrainTileData | undefined
  let positionLength = 0
  let normalLength = 0
  let uvLength = 0
  let indexLength = 0
  let minHeight = Number.POSITIVE_INFINITY
  let maxHeight = Number.NEGATIVE_INFINITY
  for (const tile of tiles) {
    firstTile ??= tile
    positionLength += tile.positions.length
    normalLength += tile.normals.length
    uvLength += tile.uvs.length
    indexLength += tile.indices.length
    minHeight = Math.min(minHeight, tile.minHeight)
    maxHeight = Math.max(maxHeight, tile.maxHeight)
  }
  const positions = new Float32Array(positionLength)
  const normals = new Float32Array(normalLength)
  const uvs = new Float32Array(uvLength)
  const indices = new Uint32Array(indexLength)

  let positionOffset = 0
  let normalOffset = 0
  let uvOffset = 0
  let indexOffset = 0
  let vertexOffset = 0
  for (const tile of tiles) {
    positions.set(tile.positions, positionOffset)
    normals.set(tile.normals, normalOffset)
    uvs.set(tile.uvs, uvOffset)
    for (let i = 0; i < tile.indices.length; i++) {
      indices[indexOffset + i] = tile.indices[i] + vertexOffset
    }
    positionOffset += tile.positions.length
    normalOffset += tile.normals.length
    uvOffset += tile.uvs.length
    indexOffset += tile.indices.length
    vertexOffset += tile.positions.length / 3
  }

  return {
    id: firstTile?.id ?? { bodyId: 'empty', face: 'px', lod: 0, x: 0, y: 0 },
    positions,
    normals,
    uvs,
    indices,
    minHeight: firstTile ? minHeight : 0,
    maxHeight: firstTile ? maxHeight : 0,
  }
}

export function bufferGeometryFromTerrainTileData(tile: TerrainTileData): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(tile.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(tile.normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(tile.uvs, 2))
  geometry.setIndex(new BufferAttribute(tile.indices, 1))
  return geometry
}
