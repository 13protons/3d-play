import { describe, expect, it } from 'vitest'
import { allFinite } from '../finite'

describe('allFinite', () => {
  it('is true for all-finite arrays', () => {
    expect(allFinite([0, -1.5, 1e9])).toBe(true)
    expect(allFinite([0, 0, 0, 1])).toBe(true)
  })

  it('is false if any element is NaN or Infinity', () => {
    expect(allFinite([0, NaN, 1])).toBe(false)
    expect(allFinite([Infinity, 0, 0])).toBe(false)
    expect(allFinite([0, 0, -Infinity, 1])).toBe(false)
  })
})
