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
  private readonly source: TerrainTileSource

  constructor(source: TerrainTileSource) {
    this.source = source
  }

  getCachedTile(id: TerrainTileId): TerrainTileData | undefined {
    return this.loaded.get(terrainTileKey(id))
  }

  async getTile(id: TerrainTileId, context: TerrainTileRequestContext): Promise<TerrainTileData> {
    const key = terrainTileKey(id)
    const loaded = this.loaded.get(key)
    if (loaded) return loaded

    const loading = this.loading.get(key)
    if (loading) return loading

    const request = this.source.getTile(id, context).then((tile) => {
      this.loaded.set(key, tile)
      this.loading.delete(key)
      return tile
    })
    this.loading.set(key, request)
    return request
  }
}
