import { describe, it, expect } from 'vitest'
import { evaluateCurve, evaluateCurveVelocity, isCurveValid } from '../curves'
import type { TrajectoryCurve } from '../types'

function makeCurve(overrides: Partial<TrajectoryCurve> = {}): TrajectoryCurve {
  return {
    id: 'test',
    parentId: '',
    p0: [0, 0, 0],
    v0: [100, 0, 0],
    t0: 0,
    p1: [100, 0, 0],
    v1: [100, 0, 0],
    t1: 1,
    ...overrides,
  }
}

describe('evaluateCurve', () => {
  it('returns p0 at t0', () => {
    const curve = makeCurve({ p0: [10, 20, 30] })
    const result = evaluateCurve(curve, 0)
    expect(result[0]).toBeCloseTo(10)
    expect(result[1]).toBeCloseTo(20)
    expect(result[2]).toBeCloseTo(30)
  })

  it('returns p1 at t1', () => {
    const curve = makeCurve({ p1: [50, 60, 70] })
    const result = evaluateCurve(curve, 1)
    expect(result[0]).toBeCloseTo(50)
    expect(result[1]).toBeCloseTo(60)
    expect(result[2]).toBeCloseTo(70)
  })

  it('interpolates midpoint for constant velocity', () => {
    // Constant velocity: p0=[0,0,0], v0=[10,0,0], p1=[10,0,0], v1=[10,0,0], dt=1
    const curve = makeCurve({
      p0: [0, 0, 0],
      v0: [10, 0, 0],
      p1: [10, 0, 0],
      v1: [10, 0, 0],
    })
    const mid = evaluateCurve(curve, 0.5)
    expect(mid[0]).toBeCloseTo(5)
  })

  it('handles non-zero t0', () => {
    const curve = makeCurve({
      t0: 10,
      t1: 20,
      p0: [0, 0, 0],
      p1: [100, 0, 0],
      v0: [10, 0, 0],
      v1: [10, 0, 0],
    })
    const result = evaluateCurve(curve, 10) // at t0
    expect(result[0]).toBeCloseTo(0)
  })

  it('extrapolates smoothly past t1', () => {
    const curve = makeCurve({
      p0: [0, 0, 0],
      v0: [10, 0, 0],
      p1: [10, 0, 0],
      v1: [10, 0, 0],
    })
    // Extrapolate slightly past t1 — should be smooth, not NaN or Infinity
    const result = evaluateCurve(curve, 1.1)
    expect(Number.isFinite(result[0])).toBe(true)
    expect(result[0]).toBeGreaterThan(10) // continues forward
  })
})

describe('evaluateCurveVelocity', () => {
  it('returns the Hermite derivative at the requested time', () => {
    const curve = makeCurve({
      p0: [0, 0, 0],
      v0: [0, 0, 0],
      p1: [10, 0, 0],
      v1: [0, 0, 0],
      t0: 0,
      t1: 10,
    })

    expect(evaluateCurveVelocity(curve, 5)).toEqual([1.5, 0, 0])
  })

  it('returns endpoint velocity for zero-duration curves', () => {
    const curve = makeCurve({
      v1: [7, 8, 9],
      t0: 0,
      t1: 0,
    })

    expect(evaluateCurveVelocity(curve, 0)).toEqual([7, 8, 9])
  })
})

describe('isCurveValid', () => {
  const curve = makeCurve({ t0: 5, t1: 10 })

  it('returns true within window', () => {
    expect(isCurveValid(curve, 7)).toBe(true)
  })

  it('returns true at boundaries', () => {
    expect(isCurveValid(curve, 5)).toBe(true)
    expect(isCurveValid(curve, 10)).toBe(true)
  })

  it('returns false outside window', () => {
    expect(isCurveValid(curve, 4.9)).toBe(false)
    expect(isCurveValid(curve, 10.1)).toBe(false)
  })
})
