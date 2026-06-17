import { describe, expect, it } from 'vitest'
import {
  angularAccelerationEuler,
  integrateAttitudeOverStep,
} from '../controls'
import { type Mat3, type Vec3, mat3Inverse, mat3MulVec, vec3Dot } from '../mat3'

const diag = (x: number, y: number, z: number): Mat3 => [x, 0, 0, 0, y, 0, 0, 0, z]

describe('angularAccelerationEuler', () => {
  it('reduces to τ/I for a spherical (scalar) inertia — no gyroscopic term', () => {
    const I = diag(2, 2, 2)
    const Iinv = mat3Inverse(I)!
    const accel = angularAccelerationEuler(I, Iinv, [1, 2, 3], [4, 8, 12])
    expect(accel[0]).toBeCloseTo(2, 10)
    expect(accel[1]).toBeCloseTo(4, 10)
    expect(accel[2]).toBeCloseTo(6, 10)
  })

  it('produces gyroscopic coupling for an asymmetric body under zero torque', () => {
    // I = diag(1,2,3), ω = [1,1,0], τ = 0.
    // Iω = [1,2,0]; ω×Iω = [0,0,1]; ω̇ = I⁻¹(−[0,0,1]) = [0,0,-1/3].
    const I = diag(1, 2, 3)
    const Iinv = mat3Inverse(I)!
    const accel = angularAccelerationEuler(I, Iinv, [1, 1, 0], [0, 0, 0])
    expect(accel[0]).toBeCloseTo(0, 10)
    expect(accel[1]).toBeCloseTo(0, 10)
    expect(accel[2]).toBeCloseTo(-1 / 3, 10)
  })

  it('spin about a principal axis is steady (zero acceleration, zero torque)', () => {
    const I = diag(1, 2, 3)
    const Iinv = mat3Inverse(I)!
    const accel = angularAccelerationEuler(I, Iinv, [0, 5, 0], [0, 0, 0])
    expect(accel[0]).toBeCloseTo(0, 10)
    expect(accel[1]).toBeCloseTo(0, 10)
    expect(accel[2]).toBeCloseTo(0, 10)
  })
})

describe('integrateAttitudeOverStep tensor path', () => {
  const I = diag(1, 2, 3)
  const Iinv = mat3Inverse(I)!

  it('conserves angular-momentum magnitude during a torque-free tumble', () => {
    // Free precession: |L| = |Iω| must hold (small forward-Euler drift allowed).
    const w0: Vec3 = [0.6, 0.4, 0.2]
    const L0 = Math.hypot(...(mat3MulVec(I, w0) as Vec3))
    const result = integrateAttitudeOverStep({
      orientation: [0, 0, 0, 1],
      angularVelocity: w0,
      momentOfInertia: [1, 2, 3],
      inertiaTensor: I,
      inertiaInverse: Iinv,
      elapsedSeconds: 2,
      torqueFor: () => [0, 0, 0],
    })
    const L1 = Math.hypot(...(mat3MulVec(I, result.angularVelocity) as Vec3))
    expect(L1).toBeCloseTo(L0, 2)
  })

  it('a constant torque about a principal axis spins the body up linearly', () => {
    const result = integrateAttitudeOverStep({
      orientation: [0, 0, 0, 1],
      angularVelocity: [0, 0, 0],
      momentOfInertia: [1, 2, 3],
      inertiaTensor: I,
      inertiaInverse: Iinv,
      elapsedSeconds: 1,
      torqueFor: () => [3, 0, 0], // τx/Ix = 3 → ω reaches ~3 rad/s after 1 s
    })
    expect(result.angularVelocity[0]).toBeCloseTo(3, 3)
    expect(result.angularVelocity[1]).toBeCloseTo(0, 6)
    expect(result.angularVelocity[2]).toBeCloseTo(0, 6)
  })

  it('falls back to the diagonal path when no tensor is supplied', () => {
    const result = integrateAttitudeOverStep({
      orientation: [0, 0, 0, 1],
      angularVelocity: [0, 0, 0],
      momentOfInertia: [2, 2, 2],
      elapsedSeconds: 1,
      torqueFor: () => [4, 0, 0], // τ/I = 2
    })
    expect(result.angularVelocity[0]).toBeCloseTo(2, 6)
  })

  it('keeps the gyroscopic axis coupling sane (energy bounded) over a long tumble', () => {
    const w0: Vec3 = [0.5, 0.5, 0.05]
    const ke0 = 0.5 * vec3Dot(w0, mat3MulVec(I, w0))
    const result = integrateAttitudeOverStep({
      orientation: [0, 0, 0, 1],
      angularVelocity: w0,
      momentOfInertia: [1, 2, 3],
      inertiaTensor: I,
      inertiaInverse: Iinv,
      elapsedSeconds: 5,
      torqueFor: () => [0, 0, 0],
    })
    const ke1 = 0.5 * vec3Dot(result.angularVelocity, mat3MulVec(I, result.angularVelocity))
    // Rotational KE is conserved in the continuous system; forward Euler drifts
    // a little but must not blow up.
    expect(Math.abs(ke1 - ke0) / ke0).toBeLessThan(0.05)
  })
})
