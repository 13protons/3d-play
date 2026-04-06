import { describe, it, expect } from 'vitest'
import { integrateVehicle } from '../vehicle/integrate'
import { CP_GRAVITY_SIZE } from '../cube-patch'
import { G } from '../constants'

function makeGravityPatch(
  min: [number, number, number],
  max: [number, number, number],
  gravity: [number, number, number],
): Float64Array {
  const patch = new Float64Array(CP_GRAVITY_SIZE)
  patch[0] = min[0]; patch[1] = min[1]; patch[2] = min[2]
  patch[3] = max[0]; patch[4] = max[1]; patch[5] = max[2]
  // Fill all 6 face gravity samples with the same uniform vector
  for (let i = 6; i < 24; i += 3) {
    patch[i] = gravity[0]; patch[i + 1] = gravity[1]; patch[i + 2] = gravity[2]
  }
  return patch
}

describe('integrateVehicle', () => {
  it('constant velocity with zero gravity', () => {
    const state = {
      position: [0, 0, 0] as [number, number, number],
      velocity: [100, 0, 0] as [number, number, number],
    }
    const patch = makeGravityPatch([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6], [0, 0, 0])
    integrateVehicle(state, patch, 1)
    expect(state.position[0]).toBeCloseTo(100, 5)
    expect(state.velocity[0]).toBeCloseTo(100, 5)
  })

  it('accelerates under uniform gravity', () => {
    const state = {
      position: [0, 0, 0] as [number, number, number],
      velocity: [0, 0, 0] as [number, number, number],
    }
    const patch = makeGravityPatch([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6], [0, -9.81, 0])
    integrateVehicle(state, patch, 1)
    expect(state.velocity[1]).toBeCloseTo(-9.81, 2)
    expect(state.position[1]).toBeCloseTo(-4.905, 2)
  })

  it('conserves energy in circular orbit over 100 steps', () => {
    const r = 6_771_000
    const M = 5.972e24
    const v = Math.sqrt(G * M / r)
    const state = {
      position: [r, 0, 0] as [number, number, number],
      velocity: [0, 0, v] as [number, number, number],
    }
    const dt = 1 / 60
    const initialKE = 0.5 * v * v
    const initialPE = -G * M / r
    const initialE = initialKE + initialPE

    for (let step = 0; step < 100; step++) {
      const [px, py, pz] = state.position
      const dist = Math.sqrt(px * px + py * py + pz * pz)
      const gMag = -G * M / (dist * dist)
      const gx = gMag * (px / dist)
      const gy = gMag * (py / dist)
      const gz = gMag * (pz / dist)
      const half = 50000
      const patch = makeGravityPatch(
        [px - half, py - half, pz - half],
        [px + half, py + half, pz + half],
        [gx, gy, gz],
      )
      integrateVehicle(state, patch, dt)
    }

    const finalSpeed = Math.sqrt(
      state.velocity[0] ** 2 + state.velocity[1] ** 2 + state.velocity[2] ** 2,
    )
    const finalDist = Math.sqrt(
      state.position[0] ** 2 + state.position[1] ** 2 + state.position[2] ** 2,
    )
    const finalE = 0.5 * finalSpeed * finalSpeed - G * M / finalDist
    const drift = Math.abs((finalE - initialE) / initialE)
    expect(drift).toBeLessThan(0.001) // <0.1%
  })
})
