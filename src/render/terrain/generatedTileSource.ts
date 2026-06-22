import type { TerrainCubeFace, TerrainTileData, TerrainTileId, TerrainTileSource, Vec3 } from './types'
import { terrainTileColumnCount } from './tileId'

const TILE_SEGMENTS = 8

export const generatedTerrainTileSource: TerrainTileSource = {
  async getTile(id, context) {
    return generateTerrainTile(id, context.bodyRadius)
  },
}

export function generateTerrainTile(id: TerrainTileId, bodyRadius: number): TerrainTileData {
  const count = terrainTileColumnCount(id.lod)
  const u0 = (id.x / count) * 2 - 1
  const u1 = ((id.x + 1) / count) * 2 - 1
  const v0 = (id.y / count) * 2 - 1
  const v1 = ((id.y + 1) / count) * 2 - 1
  const vertexCount = (TILE_SEGMENTS + 1) * (TILE_SEGMENTS + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(TILE_SEGMENTS * TILE_SEGMENTS * 6)

  let vertex = 0
  let minTextureU = Number.POSITIVE_INFINITY
  let maxTextureU = Number.NEGATIVE_INFINITY
  for (let y = 0; y <= TILE_SEGMENTS; y++) {
    const v = y / TILE_SEGMENTS
    const faceV = v0 + (v1 - v0) * v
    for (let x = 0; x <= TILE_SEGMENTS; x++) {
      const u = x / TILE_SEGMENTS
      const faceU = u0 + (u1 - u0) * u
      const normal = cubeFaceUvToDirection(id.face, faceU, faceV)
      positions[vertex * 3] = normal[0] * bodyRadius
      positions[vertex * 3 + 1] = normal[1] * bodyRadius
      positions[vertex * 3 + 2] = normal[2] * bodyRadius
      normals[vertex * 3] = normal[0]
      normals[vertex * 3 + 1] = normal[1]
      normals[vertex * 3 + 2] = normal[2]
      const [rawTextureU, textureV] = equirectangularUv(normal)
      uvs[vertex * 2] = rawTextureU
      uvs[vertex * 2 + 1] = textureV
      if (rawTextureU < minTextureU) minTextureU = rawTextureU
      if (rawTextureU > maxTextureU) maxTextureU = rawTextureU
      vertex += 1
    }
  }

  // Equirectangular seam fix. A tile straddling the ±180° meridian gets U values
  // split near 0 and near 1; left raw, the texture smears backwards across the whole
  // tile. Lift the low side onto a continuous [0.5, 1.5) branch (the body texture
  // uses RepeatWrapping on U, so >1 samples correctly). Detected from the tile's full
  // U range — a single tile-global decision, so it stays stable as the camera moves
  // and LOD changes, unlike per-vertex unwrapping anchored on the ambiguous seam
  // vertex. Tiles span far less than half the globe in longitude, so a >0.5 spread
  // can only mean a seam crossing.
  if (maxTextureU - minTextureU > 0.5) {
    for (let i = 0; i < vertexCount; i++) {
      if (uvs[i * 2] < 0.5) uvs[i * 2] += 1
    }
  }

  let index = 0
  const rowStride = TILE_SEGMENTS + 1
  for (let y = 0; y < TILE_SEGMENTS; y++) {
    for (let x = 0; x < TILE_SEGMENTS; x++) {
      const a = y * rowStride + x
      const b = a + 1
      const c = a + rowStride
      const d = c + 1
      indices[index++] = a
      indices[index++] = c
      indices[index++] = b
      indices[index++] = b
      indices[index++] = c
      indices[index++] = d
    }
  }

  return { id, positions, normals, uvs, indices, minHeight: 0, maxHeight: 0 }
}

export function cubeFaceUvToDirection(face: TerrainCubeFace, u: number, v: number): Vec3 {
  const direction: Vec3 = face === 'px'
    ? [1, -v, -u]
    : face === 'nx'
      ? [-1, -v, u]
      : face === 'py'
        ? [u, 1, v]
        : face === 'ny'
          ? [u, -1, -v]
          : face === 'pz'
            ? [u, -v, 1]
            : [-u, -v, -1]
  return normalize(direction)
}

function normalize(vector: Vec3): Vec3 {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2])
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
}

function equirectangularUv(direction: Vec3): [number, number] {
  const textureU = Math.atan2(direction[2], -direction[0]) / (Math.PI * 2)
  return [
    textureU < 0 ? textureU + 1 : textureU,
    0.5 - Math.asin(Math.min(1, Math.max(-1, direction[1]))) / Math.PI,
  ]
}
