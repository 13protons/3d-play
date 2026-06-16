import { describe, expect, it } from 'vitest'
import { countRender, drainRenderCounts } from '../perfCounters'

describe('perfCounters', () => {
  it('counts per-label renders and drains to zero', () => {
    drainRenderCounts() // clear any residue from import order
    countRender('HUD')
    countRender('HUD')
    countRender('Scene')

    const first = drainRenderCounts()
    expect(first).toEqual({ HUD: 2, Scene: 1 })

    // Draining zeroes the tally, so a subsequent drain reports no new renders.
    expect(drainRenderCounts()).toEqual({ HUD: 0, Scene: 0 })

    countRender('HUD')
    expect(drainRenderCounts().HUD).toBe(1)
  })
})
