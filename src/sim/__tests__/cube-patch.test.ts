import { describe, it, expect } from 'vitest'
import {
  CP_MIN_X, CP_MIN_Y, CP_MIN_Z,
  CP_MAX_X, CP_MAX_Y, CP_MAX_Z,
  CP_G_NEG_X, CP_G_POS_X,
  CP_G_NEG_Y, CP_G_POS_Y,
  CP_G_NEG_Z, CP_G_POS_Z,
  CP_GRAVITY_SIZE,
  evaluateGravity,
  isInsideInnerBox,
  computeCubeBounds,
} from '../cube-patch'

describe('cube-patch layout constants', () => {
  it('has correct index values', () => {
    expect(CP_MIN_X).toBe(0)
    expect(CP_MIN_Y).toBe(1)
    expect(CP_MIN_Z).toBe(2)
    expect(CP_MAX_X).toBe(3)
    expect(CP_MAX_Y).toBe(4)
    expect(CP_MAX_Z).toBe(5)
    expect(CP_G_NEG_X).toBe(6)
    expect(CP_G_POS_X).toBe(9)
    expect(CP_G_NEG_Y).toBe(12)
    expect(CP_G_POS_Y).toBe(15)
    expect(CP_G_NEG_Z).toBe(18)
    expect(CP_G_POS_Z).toBe(21)
    expect(CP_GRAVITY_SIZE).toBe(24)
  })
})

/** Helper: create a patch with given bounds and uniform gravity on all faces */
function makeUniformPatch(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  gx: number, gy: number, gz: number,
): Float64Array {
  const p = new Float64Array(24)
  p[CP_MIN_X] = minX; p[CP_MIN_Y] = minY; p[CP_MIN_Z] = minZ
  p[CP_MAX_X] = maxX; p[CP_MAX_Y] = maxY; p[CP_MAX_Z] = maxZ
  // All six faces get the same gravity vector
  for (const offset of [CP_G_NEG_X, CP_G_POS_X, CP_G_NEG_Y, CP_G_POS_Y, CP_G_NEG_Z, CP_G_POS_Z]) {
    p[offset] = gx
    p[offset + 1] = gy
    p[offset + 2] = gz
  }
  return p
}

describe('evaluateGravity', () => {
  it('returns uniform gravity everywhere in a uniform field', () => {
    const patch = makeUniformPatch(0, 0, 0, 100, 100, 100, 0, -9.8, 0)
    const out = [0, 0, 0] as [number, number, number]

    evaluateGravity(patch, 50, 50, 50, out)
    expect(out[0]).toBeCloseTo(0, 10)
    expect(out[1]).toBeCloseTo(-9.8, 10)
    expect(out[2]).toBeCloseTo(0, 10)

    // Also at a corner
    evaluateGravity(patch, 0, 0, 0, out)
    expect(out[0]).toBeCloseTo(0, 10)
    expect(out[1]).toBeCloseTo(-9.8, 10)
    expect(out[2]).toBeCloseTo(0, 10)
  })

  it('exactly reproduces a linear field sampled at face centers', () => {
    // Linear field: g(x,y,z) = (0.5*x, -0.3*y, 0.1*z)
    // Cube [0, 10]^3, center = (5, 5, 5)
    const p = new Float64Array(24)
    p[CP_MIN_X] = 0; p[CP_MIN_Y] = 0; p[CP_MIN_Z] = 0
    p[CP_MAX_X] = 10; p[CP_MAX_Y] = 10; p[CP_MAX_Z] = 10

    // Sample the linear field at each face center
    // -X (0,5,5): g = (0, -1.5, 0.5)
    p[CP_G_NEG_X] = 0; p[CP_G_NEG_X + 1] = -1.5; p[CP_G_NEG_X + 2] = 0.5
    // +X (10,5,5): g = (5, -1.5, 0.5)
    p[CP_G_POS_X] = 5; p[CP_G_POS_X + 1] = -1.5; p[CP_G_POS_X + 2] = 0.5
    // -Y (5,0,5): g = (2.5, 0, 0.5)
    p[CP_G_NEG_Y] = 2.5; p[CP_G_NEG_Y + 1] = 0; p[CP_G_NEG_Y + 2] = 0.5
    // +Y (5,10,5): g = (2.5, -3, 0.5)
    p[CP_G_POS_Y] = 2.5; p[CP_G_POS_Y + 1] = -3; p[CP_G_POS_Y + 2] = 0.5
    // -Z (5,5,0): g = (2.5, -1.5, 0)
    p[CP_G_NEG_Z] = 2.5; p[CP_G_NEG_Z + 1] = -1.5; p[CP_G_NEG_Z + 2] = 0
    // +Z (5,5,10): g = (2.5, -1.5, 1)
    p[CP_G_POS_Z] = 2.5; p[CP_G_POS_Z + 1] = -1.5; p[CP_G_POS_Z + 2] = 1

    const out = [0, 0, 0] as [number, number, number]

    // Test at several arbitrary points — should match the linear field exactly
    const testPoints: [number, number, number][] = [
      [5, 5, 5],     // center
      [0, 5, 5],     // -X face center
      [10, 5, 5],    // +X face center
      [3, 7, 2],     // arbitrary interior
      [8, 1, 9],     // another arbitrary point
    ]
    for (const [px, py, pz] of testPoints) {
      evaluateGravity(p, px, py, pz, out)
      expect(out[0]).toBeCloseTo(0.5 * px, 10)
      expect(out[1]).toBeCloseTo(-0.3 * py, 10)
      expect(out[2]).toBeCloseTo(0.1 * pz, 10)
    }
  })

  it('applies full gradient magnitude (not 1/3)', () => {
    // Key regression test: the old code averaged 3 independent axis lerps,
    // which diluted the gradient by 1/3. Verify full-strength gradient.
    const p = new Float64Array(24)
    p[CP_MIN_X] = 0; p[CP_MIN_Y] = 0; p[CP_MIN_Z] = 0
    p[CP_MAX_X] = 10; p[CP_MAX_Y] = 10; p[CP_MAX_Z] = 10

    // Uniform field except the X axis: -X=(10,0,0), +X=(20,0,0)
    // All faces get (15,0,0) except the X pair
    for (const off of [CP_G_NEG_X, CP_G_POS_X, CP_G_NEG_Y, CP_G_POS_Y, CP_G_NEG_Z, CP_G_POS_Z]) {
      p[off] = 15; p[off + 1] = 0; p[off + 2] = 0
    }
    p[CP_G_NEG_X] = 10
    p[CP_G_POS_X] = 20

    const out = [0, 0, 0] as [number, number, number]

    // Center: g0x = (10+20+15+15+15+15)/6 = 90/6 = 15
    evaluateGravity(p, 5, 5, 5, out)
    expect(out[0]).toBeCloseTo(15, 10)

    // At +X face (10,5,5): dx=5, gradient=(20-10)/10=1.0, so 15+1.0*5 = 20
    evaluateGravity(p, 10, 5, 5, out)
    expect(out[0]).toBeCloseTo(20, 10)

    // At -X face (0,5,5): 15+1.0*(-5) = 10
    evaluateGravity(p, 0, 5, 5, out)
    expect(out[0]).toBeCloseTo(10, 10)

    // At x=7.5: 15+1.0*2.5 = 17.5
    evaluateGravity(p, 7.5, 5, 5, out)
    expect(out[0]).toBeCloseTo(17.5, 10)

    // OLD BUG: the 1/3 gradient would have given:
    // at x=10: 15 + 1.0*5/3 ≈ 16.67 (not 20)
    // at x=0:  15 - 1.0*5/3 ≈ 13.33 (not 10)
  })
})

describe('isInsideInnerBox', () => {
  // Box from 0..100. Inner box is 25% inset from each side: 25..75
  const patch = makeUniformPatch(0, 0, 0, 100, 100, 100, 0, 0, 0)

  it('returns true at center', () => {
    expect(isInsideInnerBox(patch, 50, 50, 50)).toBe(true)
  })

  it('returns false outside inner box but inside outer box', () => {
    // x=10 is inside outer (0..100) but outside inner (25..75)
    expect(isInsideInnerBox(patch, 10, 50, 50)).toBe(false)
    // y=80 is outside inner
    expect(isInsideInnerBox(patch, 50, 80, 50)).toBe(false)
    // z=20 is outside inner
    expect(isInsideInnerBox(patch, 50, 50, 20)).toBe(false)
  })

  it('returns true at inner boundary', () => {
    // Exactly on the inner box boundary (25 and 75) should be inside (>=, <=)
    expect(isInsideInnerBox(patch, 25, 25, 25)).toBe(true)
    expect(isInsideInnerBox(patch, 75, 75, 75)).toBe(true)
    expect(isInsideInnerBox(patch, 25, 75, 50)).toBe(true)
  })
})

describe('computeCubeBounds', () => {
  it('centers on given position', () => {
    const bounds = computeCubeBounds(1000, 2000, 3000, 0, 1, 1)
    // With speed=0, side = max(1000, 0) = 1000, half = 500
    expect(bounds[0]).toBe(1000 - 500) // minX
    expect(bounds[1]).toBe(2000 - 500) // minY
    expect(bounds[2]).toBe(3000 - 500) // minZ
    expect(bounds[3]).toBe(1000 + 500) // maxX
    expect(bounds[4]).toBe(2000 + 500) // maxY
    expect(bounds[5]).toBe(3000 + 500) // maxZ
  })

  it('enforces 1km minimum side length', () => {
    const bounds = computeCubeBounds(0, 0, 0, 1, 1, 1)
    // speed=1, warpRate=1, dt=1 → side = max(1000, 1*1*1*4) = max(1000,4) = 1000
    const side = bounds[3] - bounds[0]
    expect(side).toBe(1000)
  })

  it('scales with speed and warp', () => {
    // speed=1000, warpRate=10, dt=2 → side = max(1000, 1000*10*2*4) = 80000
    const bounds = computeCubeBounds(0, 0, 0, 1000, 10, 2)
    const side = bounds[3] - bounds[0]
    expect(side).toBe(80000)

    const half = 80000 / 2
    expect(bounds[0]).toBe(-half)
    expect(bounds[3]).toBe(half)
  })
})
