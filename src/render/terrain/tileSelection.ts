import type { TerrainCubeFace, TerrainTileId, Vec3 } from './types'
import { clampTerrainTileY, terrainTileChildren, terrainTileColumnCount } from './tileId'
import { maxTileLodForBodyRadius, tileEdgeMeters, tileLodForCameraDistance } from './terrainLodPolicy'
import { cubeFaceUvToDirection } from './generatedTileSource'

const CUBE_FACES: TerrainCubeFace[] = ['px', 'nx', 'py', 'ny', 'pz', 'nz']

// Subdivide a tile while its on-screen size exceeds this (px). Lower → finer
// tessellation near the camera and more tiles; higher → coarser and cheaper. At 384
// a ground-level Earth view reaches the body's max LOD in a few-hundred-to-~1k tiles.
const DEFAULT_TILE_SCREEN_ERROR_PX = 384
// Hard ceiling on emitted tiles per body so a degenerate camera can't explode the
// quadtree. Sits above a normal ground view's working set; reached only in
// pathological cases, where it caps cost at the price of some uneven detail.
const MAX_SELECTED_TILES = 2048

/**
 * Adaptive cube-sphere tile selection: a screen-space-error quadtree. Starting from
 * the six cube faces at LOD 0, a tile is subdivided into its four children while its
 * projected on-screen size exceeds `screenErrorPx` and it's below the body's max LOD;
 * otherwise it's emitted as a leaf. The result covers the whole sphere with fine
 * tiles where the camera is close (the ground) and coarse tiles far away — "detail
 * where the camera is, relative to zoom".
 *
 * `cameraLocalPosition` must be the camera in the body's *local* (unrotated) frame —
 * the same frame tile geometry is generated in (direction × radius) — so distances
 * line up with the body's spin/tilt.
 */
export function selectAdaptiveCubeSphereTiles({
  bodyId,
  bodyRadius,
  cameraLocalPosition,
  fovRadians,
  viewportHeight,
  maxLod = maxTileLodForBodyRadius(bodyRadius),
  screenErrorPx = DEFAULT_TILE_SCREEN_ERROR_PX,
}: {
  bodyId: string
  bodyRadius: number
  cameraLocalPosition: Vec3
  fovRadians: number
  viewportHeight: number
  maxLod?: number
  screenErrorPx?: number
}): TerrainTileId[] {
  // Pixels a 1-metre feature spans at a given distance (perspective screen-space size).
  const pxPerMeterScale = viewportHeight / (2 * Math.tan(fovRadians / 2))
  const cameraDistance = Math.hypot(...cameraLocalPosition)
  const cameraDirection: Vec3 = cameraDistance > 0
    ? [cameraLocalPosition[0] / cameraDistance, cameraLocalPosition[1] / cameraDistance, cameraLocalPosition[2] / cameraDistance]
    : [0, 0, 1]
  // Cosine of the horizon half-angle from the body centre: a surface point is visible
  // only within this cone around the camera direction. Widens as the camera climbs
  // (orbit → nearly a full hemisphere; ground → a tiny cap), so detail is spent only
  // on what's actually on-screen. Clamp to just above the surface to stay finite.
  const cosHorizon = bodyRadius / Math.max(cameraDistance, bodyRadius * 1.0001)

  const result: TerrainTileId[] = []
  const stack: TerrainTileId[] = CUBE_FACES.map((face) => ({ bodyId, face, lod: 0, x: 0, y: 0 }))

  while (stack.length > 0) {
    const tile = stack.pop() as TerrainTileId
    // Out of budget: stop refining and emit whatever's left coarse.
    if (result.length >= MAX_SELECTED_TILES) {
      result.push(tile)
      continue
    }
    const center = tileCenterDirection(tile)
    // Horizon cull. The margin is the tile's own angular size (edge arc / radius), so
    // a coarse tile straddling the horizon is kept (and refined) while a fine tile
    // wholly beyond it is dropped — conservative, so visible tiles are never culled.
    const tileSize = tileEdgeMeters(bodyRadius, tile.lod)
    const facing = center[0] * cameraDirection[0] + center[1] * cameraDirection[1] + center[2] * cameraDirection[2]
    if (facing < cosHorizon - tileSize / bodyRadius) continue
    const dx = cameraLocalPosition[0] - center[0] * bodyRadius
    const dy = cameraLocalPosition[1] - center[1] * bodyRadius
    const dz = cameraLocalPosition[2] - center[2] * bodyRadius
    // Distance to the tile's *nearest* point, not its centre: subtract the tile's
    // world radius (half-diagonal). Using the centre makes a coarse tile straddling
    // the point below the camera look far and stop subdividing, under-tessellating
    // the ground directly underfoot.
    const distance = Math.max(1, Math.hypot(dx, dy, dz) - tileSize * Math.SQRT1_2)
    const projectedPx = tileSize * (pxPerMeterScale / distance)
    if (tile.lod < maxLod && projectedPx > screenErrorPx) {
      for (const child of terrainTileChildren(tile)) stack.push(child)
    } else {
      result.push(tile)
    }
  }
  return result
}

function tileCenterDirection(tile: TerrainTileId): Vec3 {
  const count = terrainTileColumnCount(tile.lod)
  const faceU = ((tile.x + 0.5) / count) * 2 - 1
  const faceV = ((tile.y + 0.5) / count) * 2 - 1
  return cubeFaceUvToDirection(tile.face, faceU, faceV)
}

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
