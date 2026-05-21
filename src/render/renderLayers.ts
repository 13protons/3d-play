export const RENDER_LAYERS = {
  baseBody: 0,
  terrainOverlay: 1,
  vehicle: 2,
} as const

export const TERRAIN_RENDER_PASSES = [
  { name: 'base-body', layer: RENDER_LAYERS.baseBody, clearDepthBefore: false },
  { name: 'terrain-overlay', layer: RENDER_LAYERS.terrainOverlay, clearDepthBefore: true },
  { name: 'vehicle', layer: RENDER_LAYERS.vehicle, clearDepthBefore: true },
] as const
