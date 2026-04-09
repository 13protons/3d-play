import { G } from '../constants'
import { evaluateCurve } from '../curves'
import type { DerivFn } from './adaptive'
import type { TrajectoryCurve } from '../types'

/**
 * N-body derivative function for the orbital worker.
 * State vector layout: [x0,y0,z0,vx0,vy0,vz0, x1,y1,z1,vx1,vy1,vz1, ...]
 *
 * @param masses Array of body masses in the same order as the state vector.
 */
export function nBodyDerivatives(masses: number[]): DerivFn {
  const n = masses.length

  return (_t: number, y: Float64Array, dydt: Float64Array): void => {
    for (let i = 0; i < n; i++) {
      const bi = i * 6
      // Position derivatives = velocity
      dydt[bi] = y[bi + 3]
      dydt[bi + 1] = y[bi + 4]
      dydt[bi + 2] = y[bi + 5]

      // Acceleration from all other bodies
      let ax = 0, ay = 0, az = 0
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const bj = j * 6
        const dx = y[bj] - y[bi]
        const dy = y[bj + 1] - y[bi + 1]
        const dz = y[bj + 2] - y[bi + 2]
        const r2 = dx * dx + dy * dy + dz * dz
        const r = Math.sqrt(r2)
        if (r < 1) continue
        const f = (G * masses[j]) / (r2 * r)
        ax += f * dx
        ay += f * dy
        az += f * dz
      }
      dydt[bi + 3] = ax
      dydt[bi + 4] = ay
      dydt[bi + 5] = az
    }
  }
}

/**
 * Point-mass derivative function for the vehicle worker.
 * State vector layout: [x, y, z, vx, vy, vz]
 *
 * Evaluates gravity by interpolating body positions from trajectory curves
 * at the current time t. No linear prediction — exact curve interpolation.
 *
 * @param bodyCurves Trajectory curves for all gravitating bodies.
 * @param bodyGMs    Map from curve id to G*M for that body.
 */
export function pointMassDerivatives(
  bodyCurves: TrajectoryCurve[],
  bodyGMs: Map<string, number>,
): DerivFn {
  return (t: number, y: Float64Array, dydt: Float64Array): void => {
    // Position derivatives = velocity
    dydt[0] = y[3]
    dydt[1] = y[4]
    dydt[2] = y[5]

    // Acceleration from all bodies
    let ax = 0, ay = 0, az = 0
    for (let i = 0; i < bodyCurves.length; i++) {
      const curve = bodyCurves[i]
      const gm = bodyGMs.get(curve.id)
      if (gm === undefined) continue

      // Interpolate body position at time t from its trajectory curve
      const bodyPos = evaluateCurve(curve, t)

      const dx = bodyPos[0] - y[0]
      const dy = bodyPos[1] - y[1]
      const dz = bodyPos[2] - y[2]
      const r2 = dx * dx + dy * dy + dz * dz
      const r = Math.sqrt(r2)
      if (r < 1) continue
      const f = gm / (r2 * r)
      ax += f * dx
      ay += f * dy
      az += f * dz
    }
    dydt[3] = ax
    dydt[4] = ay
    dydt[5] = az
  }
}
