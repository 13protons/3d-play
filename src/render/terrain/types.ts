export type Vec3 = [number, number, number]
export type TerrainCubeFace = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz'

export interface TerrainTileId {
  bodyId: string
  face: TerrainCubeFace
  lod: number
  x: number
  y: number
}

export interface TerrainTileData {
  id: TerrainTileId
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  minHeight: number
  maxHeight: number
}

export interface TerrainTileRequestContext {
  bodyRadius: number
}

export interface TerrainTileSource {
  getTile(id: TerrainTileId, context: TerrainTileRequestContext): Promise<TerrainTileData>
}
