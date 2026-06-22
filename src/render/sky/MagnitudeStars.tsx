import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Points } from 'three'
import { PointsNodeMaterial } from 'three/webgpu'
import { attribute, float, uniform, vec3 } from 'three/tsl'
import { createStarfieldWithMagnitudes } from './starfieldGeometry'
import { NAKED_EYE_LIMIT } from './sunHorizon'

/**
 * Magnitude-graded starfield, entirely on the GPU. Each star carries its apparent `magnitude`
 * as a vertex attribute (power-law distribution — few bright, many faint); a single `limit`
 * uniform (the sky's limiting magnitude) decides per-star brightness and size in a TSL node
 * graph. Brighter stars (lower magnitude) glow stronger and larger; additive blending means a
 * sub-threshold star adds no light and vanishes on any background.
 *
 * Drive the limit one of two ways:
 *  - static `limit` (default = the dark-sky naked-eye limit): the orbital map shows the full
 *    sky graded by intrinsic brightness;
 *  - `limitRef`: a ref the caller updates per frame (the vehicle view writes the live twilight
 *    limiting magnitude from its sky computation, so stars fade in through dusk).
 *
 * Renders as additive background (no depth write, low render order) so opaque bodies/terrain
 * paint over it and occlude stars behind them.
 */
const STAR_FADE = 1.2 // magnitudes of soft edge around the limit

/** The PointsNodeMaterial with its `limit` uniform on userData. */
function createMagnitudeStarMaterial(): PointsNodeMaterial {
  const limit = uniform(NAKED_EYE_LIMIT)
  const mag = attribute('magnitude', 'float')
  const visible = mag.smoothstep(limit.sub(STAR_FADE), limit.add(STAR_FADE)).oneMinus()
  const intrinsic = float(1.1).sub(mag.add(1.5).mul(0.1)).clamp(0.35, 1.15)
  const brightness = visible.mul(intrinsic)

  const material = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending })
  material.colorNode = vec3(brightness.mul(0.92), brightness.mul(0.96), brightness)
  material.sizeNode = brightness.mul(2.0).add(1.0)
  material.sizeAttenuation = false
  material.userData.limit = limit
  return material
}

export function MagnitudeStars({
  radius,
  count,
  limit = NAKED_EYE_LIMIT,
  limitRef,
}: {
  /** Star-shell radius in scene units. Large enough that the camera never reaches it. */
  radius: number
  count: number
  /** Static limiting magnitude (ignored when `limitRef` is supplied). */
  limit?: number
  /** Per-frame limiting magnitude, read from `.current` each frame. */
  limitRef?: MutableRefObject<number>
}) {
  const ref = useRef<Points>(null)
  const { geometry, material } = useMemo(
    () => ({ geometry: createStarfieldWithMagnitudes(radius, count), material: createMagnitudeStarMaterial() }),
    [radius, count],
  )

  useEffect(
    () => () => {
      material.dispose()
      geometry.dispose()
    },
    [material, geometry],
  )

  useFrame(() => {
    const u = (ref.current?.material as PointsNodeMaterial | undefined)?.userData.limit as
      | { value: number }
      | undefined
    if (u) u.value = limitRef ? limitRef.current : limit
  })

  return (
    <points
      ref={ref}
      geometry={geometry}
      material={material}
      renderOrder={-9}
    />
  )
}
