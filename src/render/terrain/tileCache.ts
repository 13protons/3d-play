import type {
  TerrainTileData,
  TerrainTileId,
  TerrainTileRequestContext,
  TerrainTileSource,
} from './types'
import { terrainTileKey } from './tileId'

export class TerrainTileCache {
  private readonly loaded = new Map<string, TerrainTileData>()
  private readonly loading = new Map<string, Promise<TerrainTileData>>()
  private readonly maxLoadedTiles: number
  private readonly source: TerrainTileSource

  constructor(source: TerrainTileSource, options: { maxLoadedTiles?: number } = {}) {
    this.source = source
    this.maxLoadedTiles = options.maxLoadedTiles ?? Number.POSITIVE_INFINITY
  }

  getCachedTile(id: TerrainTileId): TerrainTileData | undefined {
    const key = terrainTileKey(id)
    const tile = this.loaded.get(key)
    if (!tile) return undefined
    this.loaded.delete(key)
    this.loaded.set(key, tile)
    return tile
  }

  async getTile(id: TerrainTileId, context: TerrainTileRequestContext): Promise<TerrainTileData> {
    const key = terrainTileKey(id)
    const loaded = this.getCachedTile(id)
    if (loaded) return loaded

    const loading = this.loading.get(key)
    if (loading) return loading

    const request = this.source.getTile(id, context).then((tile) => {
      this.loaded.set(key, tile)
      this.evictLoadedTiles()
      return tile
    }).finally(() => {
      this.loading.delete(key)
    })
    this.loading.set(key, request)
    return request
  }

  private evictLoadedTiles(): void {
    while (this.loaded.size > this.maxLoadedTiles) {
      const oldestKey = this.loaded.keys().next().value as string | undefined
      if (oldestKey === undefined) return
      this.loaded.delete(oldestKey)
    }
  }
}
