import type { Camera } from 'three'
import { Vector3 } from 'three'

export interface SunScreenState {
  /** Sun position in screen UV space (0..1, y up). Meaningful only when intensity > 0. */
  uv: [number, number]
  /** 0..1 ray strength: 1 while the sun is on/near screen, fading to 0 as it leaves. */
  intensity: number
}

// Rays keep full strength until the sun's NDC coordinate passes this magnitude…
const FADE_START_NDC = 1.15
// …and are fully gone by this one. The margin past |ndc|=1 matters: rays from a
// just-off-screen sun are the effect's best look, so don't cut at the edge.
const FADE_END_NDC = 1.8

const scratch = new Vector3()

/**
 * Project the sun's camera-relative position to screen UV + a ray-strength
 * fade. Pure math (camera in, numbers out) so the projection and fade rules
 * are unit-testable without a renderer.
 */
export function sunScreenState(
  relPosition: [number, number, number],
  camera: Camera,
): SunScreenState {
  scratch.set(relPosition[0], relPosition[1], relPosition[2])

  // Behind-camera check first: projection through the camera matrix mirrors
  // points behind the eye onto the screen, which would paint rays from a
  // phantom sun. Compare against the camera's view direction directly.
  const view = scratch.clone().applyMatrix4(camera.matrixWorldInverse)
  if (view.z >= 0) return { uv: [0.5, 0.5], intensity: 0 }

  scratch.project(camera)
  const ndcMag = Math.max(Math.abs(scratch.x), Math.abs(scratch.y))
  const fade =
    1 - Math.min(1, Math.max(0, (ndcMag - FADE_START_NDC) / (FADE_END_NDC - FADE_START_NDC)))

  return {
    uv: [scratch.x * 0.5 + 0.5, scratch.y * 0.5 + 0.5],
    intensity: fade,
  }
}
