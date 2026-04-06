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

  it('returns correct value at a box corner with varying faces', () => {
    // Set up a patch where -X face has g=(1,0,0) and +X face has g=(3,0,0)
    // -Y face has g=(0,2,0), +Y has g=(0,4,0), -Z has g=(0,0,5), +Z has g=(0,0,7)
    const p = new Float64Array(24)
    p[CP_MIN_X] = 0; p[CP_MIN_Y] = 0; p[CP_MIN_Z] = 0
    p[CP_MAX_X] = 10; p[CP_MAX_Y] = 10; p[CP_MAX_Z] = 10

    // -X face gravity
    p[CP_G_NEG_X] = 1; p[CP_G_NEG_X + 1] = 0; p[CP_G_NEG_X + 2] = 0
    // +X face gravity
    p[CP_G_POS_X] = 3; p[CP_G_POS_X + 1] = 0; p[CP_G_POS_X + 2] = 0
    // -Y face gravity
    p[CP_G_NEG_Y] = 0; p[CP_G_NEG_Y + 1] = 2; p[CP_G_NEG_Y + 2] = 0
    // +Y face gravity
    p[CP_G_POS_Y] = 0; p[CP_G_POS_Y + 1] = 4; p[CP_G_POS_Y + 2] = 0
    // -Z face gravity
    p[CP_G_NEG_Z] = 0; p[CP_G_NEG_Z + 1] = 0; p[CP_G_NEG_Z + 2] = 5
    // +Z face gravity
    p[CP_G_POS_Z] = 0; p[CP_G_POS_Z + 1] = 0; p[CP_G_POS_Z + 2] = 7

    const out = [0, 0, 0] as [number, number, number]

    // At min corner (0,0,0): tx=0, ty=0, tz=0
    // gX = lerp(-X, +X, 0) = (1,0,0), gY = lerp(-Y, +Y, 0) = (0,2,0), gZ = lerp(-Z, +Z, 0) = (0,0,5)
    // avg = (1/3, 2/3, 5/3)
    evaluateGravity(p, 0, 0, 0, out)
    expect(out[0]).toBeCloseTo(1 / 3, 10)
    expect(out[1]).toBeCloseTo(2 / 3, 10)
    expect(out[2]).toBeCloseTo(5 / 3, 10)
  })

  it('interpolates between opposing faces correctly', () => {
    const p = new Float64Array(24)
    p[CP_MIN_X] = 0; p[CP_MIN_Y] = 0; p[CP_MIN_Z] = 0
    p[CP_MAX_X] = 10; p[CP_MAX_Y] = 10; p[CP_MAX_Z] = 10

    // Only X axis has non-zero gravity: -X=(0,0,0), +X=(6,0,0)
    p[CP_G_POS_X] = 6

    const out = [0, 0, 0] as [number, number, number]

    // At midpoint x=5: tx=0.5, lerp(0,6,0.5)=3
    // gX=(3,0,0), gY=(0,0,0), gZ=(0,0,0), avg=(1,0,0)
    evaluateGravity(p, 5, 5, 5, out)
    expect(out[0]).toBeCloseTo(1, 10)

    // At x=10 (tx=1): lerp(0,6,1)=6
    // avg x = 6/3 = 2
    evaluateGravity(p, 10, 5, 5, out)
    expect(out[0]).toBeCloseTo(2, 10)

    // At x=2.5 (tx=0.25): lerp(0,6,0.25)=1.5
    // avg x = 1.5/3 = 0.5
    evaluateGravity(p, 2.5, 5, 5, out)
    expect(out[0]).toBeCloseTo(0.5, 10)
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
