/**
 * Render-boundary guard: a non-finite value (NaN/Inf) fed into a Three.js
 * quaternion or matrix can corrupt the scene graph and drop the WebGL context
 * ("Aw, Snap"). Worker state should never be non-finite, but this is the cheap
 * last line of defense before numbers reach the GPU — skip the update and keep
 * the last good transform instead.
 */
export function allFinite(values: ArrayLike<number>): boolean {
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return false
  }
  return true
}
