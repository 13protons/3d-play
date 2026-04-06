import { describe, it, expect } from 'vitest'
import { gravityAtPoint } from '../orbital/gravity'
import { G } from '../constants'
import type { CelestialBody } from '../types'

// Helper to create a test body
function makeBody(id: string, mass: number, sx: number, sy: number, sz: number): CelestialBody {
  return {
    id, name: id, parentId: null as unknown as string,
    mass, radius: 1000, soiRadius: 1e9,
    position: { sector: [0, 0, 0], local: [sx, sy, sz] },
    velocity: [0, 0, 0],
    orientation: [0, 0, 0, 1] as [number, number, number, number],
    angularVelocity: 0,
  }
}

describe('gravityAtPoint', () => {
  it('computes gravity from a single body at known distance', () => {
    const body = makeBody('earth', 5.972e24, 0, 0, 0)
    const point: [number, number, number] = [6_771_000, 0, 0]
    const g = gravityAtPoint([body], point)
    const expected = (G * 5.972e24) / (6_771_000 ** 2)
    expect(Math.abs(g[0])).toBeCloseTo(expected, 0)
    expect(g[0]).toBeLessThan(0) // pulls toward body at origin
    expect(Math.abs(g[1])).toBeLessThan(1e-10)
    expect(Math.abs(g[2])).toBeLessThan(1e-10)
  })

  it('sums gravity from multiple bodies', () => {
    const b1 = makeBody('a', 1e24, 0, 0, 0)
    const b2 = makeBody('b', 1e24, 200_000, 0, 0)
    const point: [number, number, number] = [100_000, 0, 0]
    const g = gravityAtPoint([b1, b2], point)
    expect(Math.abs(g[0])).toBeLessThan(1e-10) // equidistant, forces cancel
  })
})
