import { BufferAttribute, BufferGeometry } from 'three'
import { generateTerrainTile } from './terrain/generatedTileSource'
import { terrainTileColumnCount } from './terrain/tileId'
import { minTileLodForBodyRadius } from './terrain/terrainLodPolicy'
import type { TerrainCubeFace, TerrainTileData } from './terrain/types'

const CUBE_FACES: TerrainCubeFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz']

export function generateBodySurfaceGeometryData(
  bodyRadius: number,
  lod = minTileLodForBodyRadius(),
): TerrainTileData {
  const tiles = CUBE_FACES.flatMap((face) => {
    const count = terrainTileColumnCount(lod)
    const faceTiles: TerrainTileData[] = []
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        faceTiles.push(generateTerrainTile({ bodyId: 'body-surface', face, lod, x, y }, bodyRadius))
      }
    }
    return faceTiles
  })

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
    id: { bodyId: 'body-surface', face: 'px', lod, x: 0, y: 0 },
    positions,
    normals,
    uvs,
    indices,
    minHeight: 0,
    maxHeight: 0,
  }
}

export function createBodySurfaceGeometry(bodyRadius: number): BufferGeometry {
  const surface = generateBodySurfaceGeometryData(bodyRadius)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(surface.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(surface.normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(surface.uvs, 2))
  geometry.setIndex(new BufferAttribute(surface.indices, 1))
  return geometry
}
