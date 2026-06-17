import { describe, expect, it } from 'vitest'
import {
  type Mat3,
  MAT3_IDENTITY,
  mat3Determinant,
  mat3FromQuaternion,
  mat3Inverse,
  mat3Mul,
  mat3MulVec,
  mat3Transpose,
  parallelAxisTerm,
  pointMassInertiaUnit,
  vec3Cross,
  vec3Dot,
} from '../mat3'

function expectMat3Close(actual: Mat3, expected: Mat3, digits = 10): void {
  for (let i = 0; i < 9; i++) expect(actual[i]).toBeCloseTo(expected[i], digits)
}

describe('vec3', () => {
  it('dot and cross', () => {
    expect(vec3Dot([1, 2, 3], [4, 5, 6])).toBe(32)
    expect(vec3Cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1])
  })
})

describe('mat3Mul / mat3MulVec', () => {
  it('identity is neutral', () => {
    expect(mat3MulVec(MAT3_IDENTITY, [3, 5, 7])).toEqual([3, 5, 7])
    expectMat3Close(mat3Mul(MAT3_IDENTITY, MAT3_IDENTITY), MAT3_IDENTITY)
  })

  it('multiplies row-major matrices', () => {
    const a: Mat3 = [1, 2, 3, 4, 5, 6, 7, 8, 9]
    const b: Mat3 = [9, 8, 7, 6, 5, 4, 3, 2, 1]
    expectMat3Close(mat3Mul(a, b), [30, 24, 18, 84, 69, 54, 138, 114, 90])
  })
})

describe('mat3Transpose', () => {
  it('swaps off-diagonal', () => {
    expect(mat3Transpose([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9])
  })
})

describe('mat3Inverse', () => {
  it('M · M⁻¹ = I for an invertible matrix', () => {
    const m: Mat3 = [4, 3, 0, 3, 4, 0, 0, 0, 2]
    const inv = mat3Inverse(m)
    expect(inv).not.toBeNull()
    expectMat3Close(mat3Mul(m, inv!), MAT3_IDENTITY)
  })

  it('returns null for a singular matrix', () => {
    expect(mat3Inverse([1, 2, 3, 2, 4, 6, 7, 8, 9])).toBeNull()
    expect(mat3Determinant([1, 2, 3, 2, 4, 6, 7, 8, 9])).toBe(0)
  })
})

describe('mat3FromQuaternion', () => {
  it('identity quaternion → identity matrix', () => {
    expectMat3Close(mat3FromQuaternion([0, 0, 0, 1]), MAT3_IDENTITY)
  })

  it('90° about +Z maps +X → +Y', () => {
    const q = mat3FromQuaternion([0, 0, Math.SQRT1_2, Math.SQRT1_2])
    const rotated = mat3MulVec(q, [1, 0, 0])
    expect(rotated[0]).toBeCloseTo(0, 10)
    expect(rotated[1]).toBeCloseTo(1, 10)
    expect(rotated[2]).toBeCloseTo(0, 10)
  })
})

describe('pointMassInertiaUnit', () => {
  it('axis-aligned offsets give the expected diagonal', () => {
    // r = [0,0,1]: I = diag(1,1,0)
    expectMat3Close(pointMassInertiaUnit([0, 0, 1]), [1, 0, 0, 0, 1, 0, 0, 0, 0])
    // r = [2,0,0]: |r|²=4, I = diag(0,4,4)
    expectMat3Close(pointMassInertiaUnit([2, 0, 0]), [0, 0, 0, 0, 4, 0, 0, 0, 4])
  })

  it('produces off-diagonal coupling for diagonal offsets', () => {
    // r = [1,1,0]: |r|²=2, I = [[1,-1,0],[-1,1,0],[0,0,2]]
    expectMat3Close(pointMassInertiaUnit([1, 1, 0]), [1, -1, 0, -1, 1, 0, 0, 0, 2])
  })
})

describe('parallelAxisTerm', () => {
  it('is mass × the unit point-mass inertia', () => {
    expectMat3Close(parallelAxisTerm(3, [0, 0, 1]), [3, 0, 0, 0, 3, 0, 0, 0, 0])
  })
})
