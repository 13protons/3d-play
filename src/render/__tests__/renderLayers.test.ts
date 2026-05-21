import { describe, expect, it } from 'vitest'
import { RENDER_LAYERS, TERRAIN_RENDER_PASSES } from '../renderLayers'

describe('RENDER_LAYERS', () => {
  it('keeps terrain overlay separate from base body and vehicle layers', () => {
    expect(RENDER_LAYERS.baseBody).toBe(0)
    expect(RENDER_LAYERS.terrainOverlay).not.toBe(RENDER_LAYERS.baseBody)
    expect(RENDER_LAYERS.vehicle).not.toBe(RENDER_LAYERS.terrainOverlay)
  })
})

describe('TERRAIN_RENDER_PASSES', () => {
  it('clears terrain depth before drawing the vehicle so terrain does not hide intersecting geometry', () => {
    expect(TERRAIN_RENDER_PASSES).toEqual([
      { name: 'base-body', layer: RENDER_LAYERS.baseBody, clearDepthBefore: false },
      { name: 'terrain-overlay', layer: RENDER_LAYERS.terrainOverlay, clearDepthBefore: true },
      { name: 'vehicle', layer: RENDER_LAYERS.vehicle, clearDepthBefore: true },
    ])
  })
})
