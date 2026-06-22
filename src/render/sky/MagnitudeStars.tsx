import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, InstancedBufferAttribute, Sprite } from 'three'
import { PointsNodeMaterial } from 'three/webgpu'
import { add, float, instancedBufferAttribute, mix, mul, oneMinus, pow, sin, smoothstep, sub, uniform, uv } from 'three/tsl'
import { buildStarInstanceData, loadStarCatalog } from './starCatalog'
import type { StarInstanceData } from './starCatalog'
import { NAKED_EYE_LIMIT } from './sunHorizon'

/**
 * The real naked-eye starfield (BSC5P, ~8.4k stars ≤ mag 6.5), entirely on the GPU. Each star
 * carries its true apparent `magnitude`, blackbody `color`, and a twinkle `phase`; from the
 * sky's limiting-magnitude `limit` uniform and the magnitude the TSL graph derives:
 *
 *  - luminance (brighter stars glow stronger), tinted by the star's real colour;
 *  - point size (faint stars are a single pixel; bright stars are fatter discs, so the famous
 *    bright stars and constellation shapes are recognisable);
 *  - a selective HDR boost so only the brightest stars cross the post-pipeline bloom threshold —
 *    they get a soft burst, the faint field doesn't (no full-field bloom artifacts);
 *  - an optional gentle twinkle (atmospheric scintillation) driven by a time uniform and the
 *    per-star phase, with amplitude 0 in space (orbital) and a little in the vehicle view.
 *
 * Rendered as an instanced Sprite, NOT THREE.Points: on a WebGPU backend THREE.Points is locked
 * to 1px regardless of sizeNode (three caps point primitives at 1px), so sized stars must be
 * drawn as instanced sprite quads — one quad per star, positioned/sized from instanced buffer
 * attributes. See three's PointsNodeMaterial docs (Sprite + instancing).
 *
 * Drive the limit one of two ways:
 *  - static `limit` (default = the dark-sky naked-eye limit): the orbital map shows the full sky;
 *  - `limitRef`: a ref the caller updates per frame (the vehicle view writes the live twilight
 *    limiting magnitude from its sky computation, so stars fade in through dusk).
 *
 * Additive, no depth write, low render order so opaque bodies/terrain paint over it. The
 * catalogue loads asynchronously; nothing renders until it arrives.
 */
const STAR_FADE = 1.2 // magnitudes of soft edge around the limit
const MAG_RANGE = 8.0 // mag −1.5 (brightest) … 6.5 (faintest) maps to prominence 1 … 0
const STAR_SIZE_SPREAD = 11.0 // extra pixels a max-prominence star gets over the faint field
const STAR_SIZE_CURVE = 1.6 // <2 fattens mid-bright stars too, so the brighter sky reads, not just the top few
const STAR_HDR_GAIN = 6.0 // brightest stars reach ~8× → above the bloom threshold (2.0)
const TWINKLE_SPEED = 2.5
const TWO_PI = Math.PI * 2

interface StarUniforms {
  limit: { value: number }
  time: { value: number }
  twinkleAmp: { value: number }
}

/** Build the instanced-Sprite material from per-star instance data. */
function createMagnitudeStarMaterial(data: StarInstanceData): PointsNodeMaterial {
  const limit = uniform(NAKED_EYE_LIMIT)
  const time = uniform(0)
  const twinkleAmp = uniform(0)

  // Instanced attributes (one value per star, indexed by instanceIndex). Real InstancedBuffer-
  // Attribute objects so BufferAttributeNode flags them instanced.
  const positionNode = instancedBufferAttribute<'vec3'>(new InstancedBufferAttribute(data.positions, 3), 'vec3')
  const mag = instancedBufferAttribute<'float'>(new InstancedBufferAttribute(data.magnitudes, 1), 'float')
  const starColor = instancedBufferAttribute<'vec3'>(new InstancedBufferAttribute(data.colors, 3), 'vec3')
  const phase = instancedBufferAttribute<'float'>(new InstancedBufferAttribute(data.phases, 1), 'float')

  const visible = oneMinus(smoothstep(limit.sub(STAR_FADE), limit.add(STAR_FADE), mag))
  // Prominence: 0 at the faint cutoff (mag 6.5) → 1 at the brightest (~ −1.5).
  const bright01 = sub(NAKED_EYE_LIMIT, mag).div(MAG_RANGE).clamp(0, 1)
  const intrinsic = mix(float(0.45), float(1.15), bright01)
  // Selective HDR — only the brightest few exceed the bloom threshold.
  const hdr = add(1.0, mul(pow(bright01, 3.0), STAR_HDR_GAIN))
  // Gentle per-star scintillation; amplitude 0 in space.
  const twinkle = add(1.0, mul(twinkleAmp, sin(add(mul(time, TWINKLE_SPEED), mul(phase, TWO_PI)))))
  const brightness = visible.mul(intrinsic).mul(hdr).mul(twinkle)

  // Shape each sprite quad into a round star WITHOUT dimming it: a flat full-brightness core out
  // to radius 0.42, then a soft rim to 0 by the edge. Only the corners get cut, so the bright
  // core energy that drives the dramatic bloom is preserved (a smooth radial falloff from the
  // centre instead would dim the whole interior and kill the glow).
  const radial = uv().sub(0.5).length() // 0 at centre … ~0.707 at the corner
  const disc = oneMinus(smoothstep(0.42, 0.5, radial))

  const material = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending })
  material.positionNode = positionNode
  material.colorNode = mul(starColor, mul(brightness, disc))
  // Faint stars are 1px; bright stars fatten up, and shrink back as they fade past the limit.
  material.sizeNode = add(1.0, mul(visible, mul(pow(bright01, STAR_SIZE_CURVE), STAR_SIZE_SPREAD)))
  material.sizeAttenuation = false
  material.userData.limit = limit
  material.userData.time = time
  material.userData.twinkleAmp = twinkleAmp
  return material
}

export function MagnitudeStars({
  radius,
  limit = NAKED_EYE_LIMIT,
  limitRef,
  twinkle = 0,
}: {
  /** Star-shell radius in scene units. Large enough that the camera never reaches it. */
  radius: number
  /** Static limiting magnitude (ignored when `limitRef` is supplied). */
  limit?: number
  /** Per-frame limiting magnitude, read from `.current` each frame. */
  limitRef?: MutableRefObject<number>
  /** Twinkle amplitude (atmospheric scintillation). 0 in space; ~0.3 standing on the ground. */
  twinkle?: number
}) {
  const ref = useRef<Sprite>(null)
  const [state, setState] = useState<{ material: PointsNodeMaterial; count: number } | null>(null)

  useEffect(() => {
    let stale = false
    let material: PointsNodeMaterial | undefined
    void loadStarCatalog().then((catalog) => {
      if (stale) return
      const data = buildStarInstanceData(catalog, radius)
      material = createMagnitudeStarMaterial(data)
      setState({ material, count: data.count })
    })
    return () => {
      stale = true
      material?.dispose()
    }
  }, [radius])

  // Each instance is a billboarded quad at origin; the shell is far larger than its unit-quad
  // bounds, so disable frustum culling or it pops out when the camera looks away from origin.
  useEffect(() => {
    if (ref.current && state) {
      // The WebGPU renderer reads `object.count` for instance count; Sprite doesn't type it.
      ;(ref.current as Sprite & { count: number }).count = state.count
      ref.current.frustumCulled = false
    }
  }, [state])

  useFrame((frame) => {
    const sprite = ref.current
    if (!sprite) return
    const u = (sprite.material as PointsNodeMaterial).userData as StarUniforms
    u.limit.value = limitRef ? limitRef.current : limit
    u.twinkleAmp.value = twinkle
    if (twinkle > 0) u.time.value = frame.clock.elapsedTime
  })

  if (!state) return null

  return (
    <sprite
      ref={ref}
      material={state.material}
      renderOrder={-9}
    />
  )
}
