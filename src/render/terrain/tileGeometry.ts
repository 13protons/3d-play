import { BufferAttribute, BufferGeometry } from 'three'
import { terrainTileKey } from './tileId'
import type { TerrainTileData, TerrainTileId } from './types'

export function terrainTileSelectionKey(tileIds: TerrainTileId[]): string {
  return tileIds.map(terrainTileKey).join('|')
}

export function mergeTerrainTileData(tiles: TerrainTileData[]): TerrainTileData {
  const positionLength = tiles.reduce((sum, tile) => sum + tile.positions.length, 0)
  const normalLength = tiles.reduce((sum, tile) => sum + tile.normals.length, 0)
  const uvLength = tiles.reduce((sum, tile) => sum + tile.uvs.length, 0)
  const indexLength = tiles.reduce((sum, tile) => sum + tile.indices.length, 0)
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
    id: tiles[0]?.id ?? { bodyId: 'empty', face: 'px', lod: 0, x: 0, y: 0 },
    positions,
    normals,
    uvs,
    indices,
    minHeight: Math.min(...tiles.map((tile) => tile.minHeight), 0),
    maxHeight: Math.max(...tiles.map((tile) => tile.maxHeight), 0),
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
