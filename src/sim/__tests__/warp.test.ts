import { describe, it, expect } from 'vitest'
import { WARP_RATES, nextWarpRate, prevWarpRate } from '../warp'

describe('warp rates', () => {
  it('has rates in ascending order', () => {
    for (let i = 1; i < WARP_RATES.length; i++) {
      expect(WARP_RATES[i]).toBeGreaterThan(WARP_RATES[i - 1])
    }
  })

  it('starts at 1x', () => {
    expect(WARP_RATES[0]).toBe(1)
  })
})

describe('nextWarpRate', () => {
  it('steps up through rates', () => {
    expect(nextWarpRate(1)).toBe(5)
    expect(nextWarpRate(5)).toBe(10)
    expect(nextWarpRate(100)).toBe(1000)
  })

  it('clamps at max', () => {
    expect(nextWarpRate(100000)).toBe(100000)
  })

  it('returns first rate for unknown values', () => {
    expect(nextWarpRate(42)).toBe(1)
  })
})

describe('prevWarpRate', () => {
  it('steps down through rates', () => {
    expect(prevWarpRate(100000)).toBe(10000)
    expect(prevWarpRate(5)).toBe(1)
  })

  it('clamps at min', () => {
    expect(prevWarpRate(1)).toBe(1)
  })

  it('returns first rate for unknown values', () => {
    expect(prevWarpRate(42)).toBe(1)
  })
})
