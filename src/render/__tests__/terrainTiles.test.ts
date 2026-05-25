import { describe, expect, it } from 'vitest'
import { generatedTerrainTileSource } from '../terrain/generatedTileSource'
import {
  bodySurfaceFallbackLod,
  cachedBodySurfaceGeometryData,
  createBodySurfaceGeometry,
  generateBodySurfaceGeometryData,
} from '../bodySurfaceGeometry'
import { selectCubeSphereShellTiles, selectTerrainTiles } from '../terrain/tileSelection'
import { TerrainTileCache } from '../terrain/tileCache'
import { terrainTileChildren, terrainTileKey } from '../terrain/tileId'
import { mergeTerrainTileData, terrainTileSelectionKey } from '../terrain/tileGeometry'
import {
  resolveOrbitalTerrainRenderData,
  resolveVehicleTerrainRenderData,
} from '../terrain/terrainRenderData'
import {
  maxTileLodForBodyRadius,
  maxVehicleTileCameraDistance,
  maxOrbitalTileCameraDistance,
  minTileLodForBodyRadius,
  orbitalPlanetSurfaceRenderDecision,
  planetSurfaceRenderMode,
  shouldHideFallbackSphereForTiledSurface,
  shouldUseTiledPlanetSurface,
  tileEdgeMeters,
  vehiclePlanetSurfaceRenderDecision,
} from '../terrain/terrainLodPolicy'

describe('selectTerrainTiles', () => {
  it('selects a complete cube-sphere shell for whole-body tiled rendering', () => {
    const tiles = selectCubeSphereShellTiles({ bodyId: 'earth', lod: 4 })

    expect(tiles).toHaveLength(6 * 16 * 16)
    expect(new Set(tiles.map(terrainTileKey)).size).toBe(tiles.length)
    expect(new Set(tiles.map((tile) => tile.face))).toEqual(new Set(['px', 'nx', 'py', 'ny', 'pz', 'nz']))
  })

  it('selects an overscanned tile neighborhood around the focus direction', () => {
    const tiles = selectTerrainTiles({
      bodyId: 'earth',
      bodyRadius: 6_371_000,
      cameraDistance: 6_381_000,
      focusDirection: [1, 0, 0],
      overscan: 1,
    })

    expect(tiles.length).toBe(9)
    expect(new Set(tiles.map(terrainTileKey)).size).toBe(9)
    expect(tiles.every((tile) => tile.bodyId === 'earth')).toBe(true)
    expect(tiles.every((tile) => tile.face === 'px')).toBe(true)
  })

  it('uses coarser tiles for distant orbital cameras', () => {
    const near = selectTerrainTiles({
      bodyId: 'earth',
      bodyRadius: 6_371_000,
      cameraDistance: 6_381_000,
      focusDirection: [1, 0, 0],
      overscan: 0,
    })[0]
    const far = selectTerrainTiles({
      bodyId: 'earth',
      bodyRadius: 6_371_000,
      cameraDistance: 50_000_000,
      focusDirection: [1, 0, 0],
      overscan: 0,
    })[0]

    expect(near.lod).toBeGreaterThan(far.lod)
  })
})

describe('generatedTerrainTileSource', () => {
  it('returns serializable spherical tile geometry on the requested body radius', async () => {
    const tile = await generatedTerrainTileSource.getTile({
      bodyId: 'earth',
      face: 'px',
      lod: 2,
      x: 2,
      y: 1,
    }, { bodyRadius: 100 })

    expect(tile.positions).toBeInstanceOf(Float32Array)
    expect(tile.normals).toBeInstanceOf(Float32Array)
    expect(tile.indices).toBeInstanceOf(Uint32Array)
    expect(tile.minHeight).toBe(0)
    expect(tile.maxHeight).toBe(0)

    const firstRadius = Math.hypot(tile.positions[0], tile.positions[1], tile.positions[2])
    expect(firstRadius).toBeCloseTo(100, 4)
  })

  it('projects cube-face tile vertices onto the requested sphere', async () => {
    const tile = await generatedTerrainTileSource.getTile({
      bodyId: 'earth',
      face: 'pz',
      lod: 1,
      x: 1,
      y: 0,
    }, { bodyRadius: 250 })

    for (let i = 0; i < tile.positions.length; i += 3) {
      expect(Math.hypot(
        tile.positions[i],
        tile.positions[i + 1],
        tile.positions[i + 2],
      )).toBeCloseTo(250, 3)
    }
  })

  it('uses the same equirectangular orientation as sphereGeometry textures', async () => {
    const tile = await generatedTerrainTileSource.getTile({
      bodyId: 'earth',
      face: 'pz',
      lod: 0,
      x: 0,
      y: 0,
    }, { bodyRadius: 100 })

    const rowStride = Math.sqrt(tile.uvs.length / 2)
    const center = ((Math.floor(rowStride / 2) * rowStride) + Math.floor(rowStride / 2)) * 2

    expect(tile.uvs[center]).toBeCloseTo(0.25, 6)
    expect(tile.uvs[center + 1]).toBeCloseTo(0.5, 6)
  })

  it('uses terrain tile UVs for the fallback body surface geometry', async () => {
    const terrainTile = await generatedTerrainTileSource.getTile({
      bodyId: 'earth',
      face: 'pz',
      lod: 0,
      x: 0,
      y: 0,
    }, { bodyRadius: 100 })
    const fallbackSurface = generateBodySurfaceGeometryData(100, 0)

    const terrainCenter = ((4 * 9) + 4) * 2
    const fallbackPzOffset = 4 * 81 * 2
    const fallbackCenter = fallbackPzOffset + terrainCenter

    expect(fallbackSurface.uvs[fallbackCenter]).toBeCloseTo(terrainTile.uvs[terrainCenter], 6)
    expect(fallbackSurface.uvs[fallbackCenter + 1]).toBeCloseTo(terrainTile.uvs[terrainCenter + 1], 6)
  })

  it('uses a coarser default fallback surface than tiled rendering', () => {
    expect(bodySurfaceFallbackLod()).toBeLessThan(minTileLodForBodyRadius())
  })

  it('reuses cached fallback surface data without sharing BufferGeometry instances', () => {
    const firstData = cachedBodySurfaceGeometryData(100)
    const secondData = cachedBodySurfaceGeometryData(100)
    const firstGeometry = createBodySurfaceGeometry(100)
    const secondGeometry = createBodySurfaceGeometry(100)

    expect(secondData).toBe(firstData)
    expect(secondGeometry).not.toBe(firstGeometry)
    expect(secondGeometry.getAttribute('position').array).toBe(firstGeometry.getAttribute('position').array)
  })

  it('keeps equirectangular u coordinates continuous inside seam-crossing tiles', async () => {
    const tile = await generatedTerrainTileSource.getTile({
      bodyId: 'earth',
      face: 'nx',
      lod: 4,
      x: 7,
      y: 8,
    }, { bodyRadius: 100 })

    const rowStride = Math.sqrt(tile.uvs.length / 2)
    let maxAdjacentDelta = 0
    for (let y = 0; y < rowStride; y++) {
      for (let x = 0; x < rowStride - 1; x++) {
        const left = (y * rowStride + x) * 2
        const right = left + 2
        maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(tile.uvs[left] - tile.uvs[right]))
      }
    }

    expect(maxAdjacentDelta).toBeLessThan(0.25)
  })

  it('keeps equirectangular u coordinates continuous through polar tiles', async () => {
    const tile = await generatedTerrainTileSource.getTile({
      bodyId: 'earth',
      face: 'py',
      lod: 4,
      x: 7,
      y: 7,
    }, { bodyRadius: 100 })

    const rowStride = Math.sqrt(tile.uvs.length / 2)
    let maxAdjacentDelta = 0
    for (let y = 0; y < rowStride - 1; y++) {
      for (let x = 0; x < rowStride; x++) {
        const top = (y * rowStride + x) * 2
        const bottom = ((y + 1) * rowStride + x) * 2
        maxAdjacentDelta = Math.max(maxAdjacentDelta, Math.abs(tile.uvs[top] - tile.uvs[bottom]))
      }
    }

    expect(maxAdjacentDelta).toBeLessThan(0.5)
  })
})

describe('terrainTileGeometry', () => {
  it('builds a stable selection key without depending on array identity', () => {
    const tiles = selectCubeSphereShellTiles({ bodyId: 'earth', lod: 1 })
    const copiedTiles = tiles.map((tile) => ({ ...tile }))

    expect(terrainTileSelectionKey(copiedTiles)).toBe(terrainTileSelectionKey(tiles))
  })

  it('merges terrain tile geometry and offsets later tile indices', () => {
    const first = {
      id: { bodyId: 'earth', face: 'px' as const, lod: 0, x: 0, y: 0 },
      positions: new Float32Array([0, 0, 1, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      minHeight: 0,
      maxHeight: 0,
    }
    const second = {
      id: { bodyId: 'earth', face: 'nx' as const, lod: 0, x: 0, y: 0 },
      positions: new Float32Array([0, 0, -1, -1, 0, 0, 0, -1, 0]),
      normals: new Float32Array([0, 0, -1, 0, 0, -1, 0, 0, -1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 2, 1]),
      minHeight: 0,
      maxHeight: 0,
    }

    const merged = mergeTerrainTileData([first, second])

    expect(merged.positions).toBeInstanceOf(Float32Array)
    expect(merged.indices).toBeInstanceOf(Uint32Array)
    expect(Array.from(merged.positions)).toEqual([...first.positions, ...second.positions])
    expect(Array.from(merged.indices)).toEqual([0, 1, 2, 3, 5, 4])
  })
})

describe('terrainRenderData', () => {
  const body = {
    id: 'earth',
    name: 'Earth',
    parentId: 'sun',
    mass: 1,
    gm: 1,
    radius: 100,
    axialTilt: 23.5,
    angularVelocity: 0.1,
    rotationPhase: 0.2,
    color: '#ffffff',
    emissive: false,
    minimumLight: 0,
  }

  it('resolves orbital terrain placement from evaluated positions', () => {
    const renderData = resolveOrbitalTerrainRenderData({
      body,
      bodyPosition: [1_000, 0, 0],
      targetPosition: [100, 0, 0],
      cameraPosition: [900, 0, 0],
      fovRadians: Math.PI / 3,
      viewportHeight: 1_000,
      simTime: 2,
    })

    expect(renderData).toMatchObject({
      view: 'orbital',
      groupPosition: [900, 0, 0],
      cameraDistance: 0,
      showTerrainTiles: true,
    })
    expect(renderData?.rotation).toEqual([0, 0.4, (23.5 * Math.PI) / 180, 'ZXY'])
  })

  it('returns null when vehicle terrain would not actually replace the parent surface', () => {
    const renderData = resolveVehicleTerrainRenderData({
      body,
      bodyPosition: [0, 0, 0],
      vehiclePosition: [110, 0, 0],
      vehicleParentId: 'moon',
      cameraPosition: [0, 0, 1],
      fovRadians: Math.PI / 3,
      viewportHeight: 1_000,
      simTime: 0,
    })

    expect(renderData).toBeNull()
  })

  it('resolves vehicle terrain placement from evaluated positions', () => {
    const renderData = resolveVehicleTerrainRenderData({
      body,
      bodyPosition: [0, 0, 0],
      vehiclePosition: [110, 0, 0],
      vehicleParentId: 'earth',
      cameraPosition: [0, 0, 1],
      fovRadians: Math.PI / 3,
      viewportHeight: 1_000,
      simTime: 2,
    })

    expect(renderData).toMatchObject({
      view: 'vehicle',
      groupPosition: [-110, 0, 0],
      cameraDistance: expect.any(Number),
      showTerrainTiles: true,
    })
    expect(renderData?.focusDirection).toEqual([1, 0, 0])
  })
})

describe('terrainTileId', () => {
  it('uses power-of-two quadtree child addresses per cube face', () => {
    expect(terrainTileChildren({ bodyId: 'earth', face: 'ny', lod: 4, x: 3, y: 5 })).toEqual([
      { bodyId: 'earth', face: 'ny', lod: 5, x: 6, y: 10 },
      { bodyId: 'earth', face: 'ny', lod: 5, x: 7, y: 10 },
      { bodyId: 'earth', face: 'ny', lod: 5, x: 6, y: 11 },
      { bodyId: 'earth', face: 'ny', lod: 5, x: 7, y: 11 },
    ])
  })
})

describe('terrainLodPolicy', () => {
  it('uses body radius to compute tile edge size', () => {
    expect(tileEdgeMeters(6_371_000, 16)).toBeCloseTo(194.4, 1)
    expect(tileEdgeMeters(696_340_000, 20)).toBeCloseTo(1328.2, 1)
  })

  it('switches from sphere to tiles when the planet fills enough of the frame', () => {
    expect(shouldUseTiledPlanetSurface(0.08)).toBe(false)
    expect(shouldUseTiledPlanetSurface(0.12)).toBe(true)
  })

  it('switches the sphere fallback off at the same threshold that tiles activate', () => {
    expect(shouldUseTiledPlanetSurface(0.12)).toBe(true)
    expect(shouldHideFallbackSphereForTiledSurface(0.12)).toBe(true)
    expect(shouldHideFallbackSphereForTiledSurface(0.14)).toBe(true)
  })

  it('uses one exclusive surface render mode at the tile threshold', () => {
    expect(planetSurfaceRenderMode(0.119)).toBe('sphere')
    expect(planetSurfaceRenderMode(0.12)).toBe('tiles')
    expect(shouldUseTiledPlanetSurface(0.12)).toBe(true)
    expect(shouldHideFallbackSphereForTiledSurface(0.12)).toBe(true)
  })

  it('keeps orbital terrain eligible until after the sphere fallback can return', () => {
    const bodyRadius = 100
    const fovRadians = Math.PI / 3
    const distanceWhereSphereMayHide = bodyRadius / (0.14 * Math.tan(fovRadians / 2))

    expect(maxOrbitalTileCameraDistance(bodyRadius, fovRadians)).toBeGreaterThan(distanceWhereSphereMayHide)
  })

  it('caps rocky planet tile LOD near 16 and sun tile LOD near 20', () => {
    expect(maxTileLodForBodyRadius(6_371_000)).toBe(16)
    expect(maxTileLodForBodyRadius(696_340_000)).toBe(20)
  })

  it('limits vehicle-view terrain tiles to close camera distances', () => {
    expect(maxVehicleTileCameraDistance(6_371_000)).toBeCloseTo(127_420, 0)
    expect(maxVehicleTileCameraDistance(1_737_000)).toBeCloseTo(34_740, 0)
  })

  it('returns one exclusive orbital surface visibility decision', () => {
    expect(orbitalPlanetSurfaceRenderDecision({
      bodyRadius: 100,
      cameraDistance: 4_000,
      fovRadians: Math.PI / 3,
      viewportHeight: 1_000,
    })).toMatchObject({
      mode: 'sphere',
      showFallbackSphere: true,
      showTerrainTiles: false,
    })

    expect(orbitalPlanetSurfaceRenderDecision({
      bodyRadius: 100,
      cameraDistance: 1_000,
      fovRadians: Math.PI / 3,
      viewportHeight: 1_000,
    })).toMatchObject({
      mode: 'tiles',
      showFallbackSphere: false,
      showTerrainTiles: true,
    })
  })

  it('keeps the vehicle fallback visible unless terrain tiles are actually eligible', () => {
    const baseDecision = {
      bodyId: 'earth',
      vehicleParentId: 'earth',
      bodyRadius: 100,
      bodyDistance: 110,
      localCameraDistance: 1,
      cameraDistance: 1_000,
      fovRadians: Math.PI / 3,
      viewportHeight: 1_000,
    }

    expect(vehiclePlanetSurfaceRenderDecision(baseDecision)).toMatchObject({
      mode: 'tiles',
      showFallbackSphere: false,
      showTerrainTiles: true,
    })

    expect(vehiclePlanetSurfaceRenderDecision({
      ...baseDecision,
      vehicleParentId: 'moon',
    })).toMatchObject({
      mode: 'sphere',
      showFallbackSphere: true,
      showTerrainTiles: false,
    })

    expect(vehiclePlanetSurfaceRenderDecision({
      ...baseDecision,
      bodyDistance: 121,
    })).toMatchObject({
      mode: 'sphere',
      showFallbackSphere: true,
      showTerrainTiles: false,
    })

    expect(vehiclePlanetSurfaceRenderDecision({
      ...baseDecision,
      localCameraDistance: maxVehicleTileCameraDistance(100) + 1,
    })).toMatchObject({
      mode: 'sphere',
      showFallbackSphere: true,
      showTerrainTiles: false,
    })
  })
})

describe('TerrainTileCache', () => {
  it('deduplicates in-flight tile requests', async () => {
    let calls = 0
    const cache = new TerrainTileCache({
      getTile: async (id) => {
        calls += 1
        return {
          id,
          positions: new Float32Array(),
          normals: new Float32Array(),
          uvs: new Float32Array(),
          indices: new Uint32Array(),
          minHeight: 0,
          maxHeight: 0,
        }
      },
    })

    const id = { bodyId: 'earth', face: 'px' as const, lod: 1, x: 0, y: 0 }
    const [a, b] = await Promise.all([
      cache.getTile(id, { bodyRadius: 100 }),
      cache.getTile(id, { bodyRadius: 100 }),
    ])

    expect(a).toBe(b)
    expect(calls).toBe(1)
  })

  it('clears failed in-flight requests so later loads can retry', async () => {
    let calls = 0
    const id = { bodyId: 'earth', face: 'px' as const, lod: 1, x: 0, y: 0 }
    const tile = {
      id,
      positions: new Float32Array(),
      normals: new Float32Array(),
      uvs: new Float32Array(),
      indices: new Uint32Array(),
      minHeight: 0,
      maxHeight: 0,
    }
    const cache = new TerrainTileCache({
      getTile: async () => {
        calls += 1
        if (calls === 1) throw new Error('temporary tile load failure')
        return tile
      },
    })

    await expect(cache.getTile(id, { bodyRadius: 100 })).rejects.toThrow('temporary tile load failure')
    await expect(cache.getTile(id, { bodyRadius: 100 })).resolves.toBe(tile)
    expect(calls).toBe(2)
  })

  it('evicts least-recently-used loaded tiles when the cache exceeds its bound', async () => {
    const cache = new TerrainTileCache({
      getTile: async (id) => ({
        id,
        positions: new Float32Array(),
        normals: new Float32Array(),
        uvs: new Float32Array(),
        indices: new Uint32Array(),
        minHeight: 0,
        maxHeight: 0,
      }),
    }, { maxLoadedTiles: 2 })
    const first = { bodyId: 'earth', face: 'px' as const, lod: 1, x: 0, y: 0 }
    const second = { bodyId: 'earth', face: 'px' as const, lod: 1, x: 1, y: 0 }
    const third = { bodyId: 'earth', face: 'px' as const, lod: 1, x: 0, y: 1 }

    await cache.getTile(first, { bodyRadius: 100 })
    await cache.getTile(second, { bodyRadius: 100 })
    cache.getCachedTile(first)
    await cache.getTile(third, { bodyRadius: 100 })

    expect(cache.getCachedTile(first)).toBeDefined()
    expect(cache.getCachedTile(second)).toBeUndefined()
    expect(cache.getCachedTile(third)).toBeDefined()
  })
})
