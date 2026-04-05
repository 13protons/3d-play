import type { EnvironmentPatch } from '../types'

/**
 * Evaluate an EnvironmentPatch at a position offset from the patch center.
 * This is the vehicle worker's interface to atmospheric, terrain, and gravity data.
 * It does NOT know how these fields are computed — just evaluates cheap math.
 */

/** Atmospheric density at an offset from patch center. */
export function densityAt(
  patch: EnvironmentPatch,
  offset: [number, number, number],
): number {
  const a = patch.atmosphere!
  return (
    a.density +
    a.densityGradient[0] * offset[0] +
    a.densityGradient[1] * offset[1] +
    a.densityGradient[2] * offset[2]
  )
}

/** Gravity vector at an offset from patch center. */
export function gravityAt(
  patch: EnvironmentPatch,
  offset: [number, number, number],
): [number, number, number] {
  const g = patch.gravity!
  return [
    g.acceleration[0] + g.tidal[0] * offset[0] + g.tidal[1] * offset[1] + g.tidal[2] * offset[2],
    g.acceleration[1] + g.tidal[3] * offset[0] + g.tidal[4] * offset[1] + g.tidal[5] * offset[2],
    g.acceleration[2] + g.tidal[6] * offset[0] + g.tidal[7] * offset[1] + g.tidal[8] * offset[2],
  ]
}
