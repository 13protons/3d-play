import { G } from '../constants'
import type { DerivFn } from './adaptive'
import type { TrajectoryCurve } from '../types'

/**
 * N-body derivative function for the orbital worker.
 * State vector layout: [x0,y0,z0,vx0,vy0,vz0, x1,y1,z1,vx1,vy1,vz1, ...]
 *
 * @param masses Array of body masses in the same order as the state vector.
 */
export function nBodyDerivatives(masses: number[]): DerivFn {
  return nBodyDerivativesFromGMs(masses.map((mass) => G * mass))
}

/**
 * N-body derivative function using gravitational parameters directly.
 * State vector layout: [x0,y0,z0,vx0,vy0,vz0, x1,y1,z1,vx1,vy1,vz1, ...]
 *
 * @param gms Array of G*M values in m^3/s^2 in the same order as the state vector.
 */
export function nBodyDerivativesFromGMs(gms: number[]): DerivFn {
  const n = gms.length

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
        const f = gms[j] / (r2 * r)
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

/** Pre-resolved body curve + GM pair for the hot path. */
interface BodySource {
  curve: TrajectoryCurve
  gm: number
}

/**
 * Point-mass derivative function for the vehicle worker.
 * State vector layout: [x, y, z, vx, vy, vz]
 *
 * Evaluates gravity by interpolating body positions from trajectory curves
 * at the current time t using inline cubic Hermite (no allocation on hot path).
 *
 * @param bodyCurves Trajectory curves for all gravitating bodies.
 * @param bodyGMs    Map from curve id to G*M for that body.
 */
export function pointMassDerivatives(
  bodyCurves: TrajectoryCurve[],
  bodyGMs: Map<string, number>,
): DerivFn {
  // Pre-resolve GM values at construction time to avoid Map lookups on the hot path
  const sources: BodySource[] = []
  for (let i = 0; i < bodyCurves.length; i++) {
    const gm = bodyGMs.get(bodyCurves[i].id)
    if (gm !== undefined) sources.push({ curve: bodyCurves[i], gm })
  }

  return (t: number, y: Float64Array, dydt: Float64Array): void => {
    // Position derivatives = velocity
    dydt[0] = y[3]
    dydt[1] = y[4]
    dydt[2] = y[5]

    // Acceleration from all bodies
    let ax = 0, ay = 0, az = 0
    for (let i = 0; i < sources.length; i++) {
      const { curve, gm } = sources[i]

      // Inline cubic Hermite interpolation (avoids tuple allocation per call)
      const cdt = curve.t1 - curve.t0
      const s = (t - curve.t0) / cdt
      const s2 = s * s
      const s3 = s2 * s
      const h00 = 2 * s3 - 3 * s2 + 1
      const h10 = s3 - 2 * s2 + s
      const h01 = -2 * s3 + 3 * s2
      const h11 = s3 - s2
      const bpx = h00 * curve.p0[0] + h10 * cdt * curve.v0[0] + h01 * curve.p1[0] + h11 * cdt * curve.v1[0]
      const bpy = h00 * curve.p0[1] + h10 * cdt * curve.v0[1] + h01 * curve.p1[1] + h11 * cdt * curve.v1[1]
      const bpz = h00 * curve.p0[2] + h10 * cdt * curve.v0[2] + h01 * curve.p1[2] + h11 * cdt * curve.v1[2]

      const dx = bpx - y[0]
      const dy = bpy - y[1]
      const dz = bpz - y[2]
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
