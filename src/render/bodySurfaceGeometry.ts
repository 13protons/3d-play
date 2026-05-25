import { BufferAttribute, BufferGeometry } from 'three'
import { generateTerrainTile } from './terrain/generatedTileSource'
import { mergeTerrainTileData } from './terrain/tileGeometry'
import { terrainTileColumnCount } from './terrain/tileId'
import { minTileLodForBodyRadius } from './terrain/terrainLodPolicy'
import type { TerrainCubeFace, TerrainTileData } from './terrain/types'

const CUBE_FACES: TerrainCubeFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz']
const FALLBACK_SURFACE_LOD = 1
const fallbackGeometryDataCache = new Map<string, TerrainTileData>()

export function bodySurfaceFallbackLod(): number {
  return FALLBACK_SURFACE_LOD
}

export function cachedBodySurfaceGeometryData(
  bodyRadius: number,
  lod = bodySurfaceFallbackLod(),
): TerrainTileData {
  const key = `${bodyRadius}:${lod}`
  const cached = fallbackGeometryDataCache.get(key)
  if (cached) return cached
  const generated = generateBodySurfaceGeometryData(bodyRadius, lod)
  fallbackGeometryDataCache.set(key, generated)
  return generated
}

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

  return mergeTerrainTileData(tiles)
}

export function createBodySurfaceGeometry(
  bodyRadius: number,
  lod = bodySurfaceFallbackLod(),
): BufferGeometry {
  const surface = cachedBodySurfaceGeometryData(bodyRadius, lod)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(surface.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(surface.normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(surface.uvs, 2))
  geometry.setIndex(new BufferAttribute(surface.indices, 1))
  return geometry
}
