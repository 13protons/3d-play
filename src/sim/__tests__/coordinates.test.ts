import { describe, it, expect } from 'vitest'
import { normalize, relativePosition, toAbsolute } from '../coordinates'
import { SECTOR_SIZE } from '../constants'
import type { SectorPosition } from '../types'

describe('normalize', () => {
  it('leaves already-normalized positions unchanged', () => {
    const pos: SectorPosition = { sector: [1, 2, 3], local: [500, 600, 700] }
    const result = normalize(pos)
    expect(result.sector).toEqual([1, 2, 3])
    expect(result.local).toEqual([500, 600, 700])
  })

  it('wraps positive overflow into next sector', () => {
    const pos: SectorPosition = {
      sector: [0, 0, 0],
      local: [SECTOR_SIZE + 100, 0, 0],
    }
    const result = normalize(pos)
    expect(result.sector).toEqual([1, 0, 0])
    expect(result.local[0]).toBeCloseTo(100)
  })

  it('wraps negative offset into previous sector', () => {
    const pos: SectorPosition = {
      sector: [5, 0, 0],
      local: [-100, 0, 0],
    }
    const result = normalize(pos)
    expect(result.sector).toEqual([4, 0, 0])
    expect(result.local[0]).toBeCloseTo(SECTOR_SIZE - 100)
  })

  it('handles multi-sector jumps', () => {
    const pos: SectorPosition = {
      sector: [0, 0, 0],
      local: [3.5 * SECTOR_SIZE, 0, 0],
    }
    const result = normalize(pos)
    expect(result.sector).toEqual([3, 0, 0])
    expect(result.local[0]).toBeCloseTo(0.5 * SECTOR_SIZE)
  })

  it('handles negative multi-sector jumps', () => {
    const pos: SectorPosition = {
      sector: [10, 0, 0],
      local: [-2.5 * SECTOR_SIZE, 0, 0],
    }
    const result = normalize(pos)
    expect(result.sector).toEqual([7, 0, 0])
    expect(result.local[0]).toBeCloseTo(0.5 * SECTOR_SIZE)
  })
})

describe('relativePosition', () => {
  it('returns zero for same position', () => {
    const pos: SectorPosition = { sector: [100, 200, 300], local: [500, 600, 700] }
    const result = relativePosition(pos, pos)
    expect(result).toEqual([0, 0, 0])
  })

  it('computes offset within same sector', () => {
    const a: SectorPosition = { sector: [0, 0, 0], local: [100, 0, 0] }
    const b: SectorPosition = { sector: [0, 0, 0], local: [300, 0, 0] }
    const result = relativePosition(a, b)
    expect(result).toEqual([200, 0, 0])
  })

  it('computes offset across sectors', () => {
    const a: SectorPosition = { sector: [0, 0, 0], local: [900000, 0, 0] }
    const b: SectorPosition = { sector: [1, 0, 0], local: [100, 0, 0] }
    const result = relativePosition(a, b)
    expect(result[0]).toBeCloseTo(100100)
  })

  it('preserves precision for nearby objects at large sector offsets', () => {
    // Two objects 10 meters apart, both at Earth's orbital distance
    const a: SectorPosition = { sector: [149600, 0, 0], local: [0, 0, 0] }
    const b: SectorPosition = { sector: [149600, 0, 0], local: [10, 0, 0] }
    const result = relativePosition(a, b)
    expect(result[0]).toBe(10) // exact, no floating point loss
  })
})

describe('toAbsolute', () => {
  it('converts origin to zero vector', () => {
    const pos: SectorPosition = { sector: [0, 0, 0], local: [0, 0, 0] }
    expect(toAbsolute(pos)).toEqual([0, 0, 0])
  })

  it('combines sector and local', () => {
    const pos: SectorPosition = { sector: [1, 0, 0], local: [500, 0, 0] }
    const result = toAbsolute(pos)
    expect(result[0]).toBe(SECTOR_SIZE + 500)
  })
})
