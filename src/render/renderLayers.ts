export const RENDER_LAYERS = {
  baseBody: 0,
  terrainOverlay: 1,
  vehicle: 2,
  atmosphere: 3,
} as const

export const TERRAIN_RENDER_PASSES = [
  { name: 'base-body', layer: RENDER_LAYERS.baseBody, clearDepthBefore: false },
  { name: 'terrain-overlay', layer: RENDER_LAYERS.terrainOverlay, clearDepthBefore: false },
  // Atmosphere scatters additively over the surface + stars already in the
  // framebuffer. It computes planet occlusion analytically (its material has no
  // depth test), so it draws after terrain but before the vehicle pass clears
  // depth and paints the (close, opaque) vehicle on top.
  { name: 'atmosphere', layer: RENDER_LAYERS.atmosphere, clearDepthBefore: false },
  { name: 'vehicle', layer: RENDER_LAYERS.vehicle, clearDepthBefore: true },
] as const
