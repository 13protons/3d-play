import { Color, Vector2 } from 'three'
import {
  Fn,
  If,
  Loop,
  float,
  interleavedGradientNoise,
  screenCoordinate,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl'
import type { Node, TextureNode } from 'three/webgpu'

/**
 * Screen-space god-rays (crepuscular rays) for the sun — the classic
 * Kenny-Mitchell radial march, built in TSL for the WebGPU pipeline.
 *
 * No extra scene render: the "occlusion buffer" is derived procedurally from
 * the beauty pass's DEPTH texture. A pixel contributes light when it is sky
 * (depth at the far clear value — nothing was drawn there) AND falls inside a
 * soft sun disc around the sun's projected screen position. Planets write
 * depth, so they occlude the disc — rays wrap around limbs and vanish during
 * eclipses with no special casing. The sun's own glow sprite doesn't write
 * depth, so it never occludes itself.
 *
 * Each fragment marches SAMPLES steps toward the sun's screen position,
 * accumulating decayed occlusion-disc hits; a per-pixel interleaved-gradient
 * jitter on the march offset hides the step banding.
 *
 * The per-frame inputs (sun screen uv, edge-fade intensity, tint, aspect) are
 * uniforms driven by the caller (see RenderPipeline + sunScreenState).
 */

// March steps per pixel. Kept low — this runs full-screen and dominates the
// pass's cost; the per-pixel jitter turns undersampling into noise instead of
// banding, so 20 reads like 2× as many un-jittered steps.
const SAMPLES = 20
// Fraction of the pixel→sun distance covered by the march (1 = all the way).
const DENSITY = 0.92
// Per-sample energy decay: smaller = tighter rays hugging the sun.
const DECAY = 0.92
// Radius of the light-emitting sun disc, as a fraction of viewport height —
// a touch larger than the sun sprite's bright core so rays seed from the glow.
const SUN_DISC_RADIUS = 0.04
// Overall ray brightness. Values stay below the bloom threshold (2.0): the
// rays are LDR scene light, not a bloom source, so they cannot re-introduce
// the subpixel bloom flicker the baked-halo sun removed.
const EXPOSURE = 2.4
// Sky test threshold for STANDARD depth: cleared texels sit at 1.0 and drawn
// geometry lands below; the margin covers float32 rounding for bodies out to
// ~1e10 m (beyond that a body's depth rounds to 1.0 and it reads as sky — such
// bodies are sub-pixel and can't meaningfully occlude anyway). On REVERSED-Z
// canvases (the vehicle view) the clear value is 0.0 and any drawn geometry
// writes a strictly positive value, so the test is an exact compare against 0.
const SKY_DEPTH = 0.9999999

/** The uniform handles the caller drives per frame (typed by their `.value`). */
export interface GodRaysControls {
  sunUv: { value: Vector2 }
  intensity: { value: number }
  tint: { value: Color }
  aspect: { value: number }
}

export interface GodRaysOptions {
  /** Set when the canvas uses a reversed-Z depth buffer (the vehicle view). */
  reversedDepth?: boolean
}

export function buildGodRays(
  depthNode: TextureNode,
  { reversedDepth = false }: GodRaysOptions = {},
): { node: Node; controls: GodRaysControls } {
  const sunUv = uniform(new Vector2(0.5, 0.5))
  const intensity = uniform(0)
  const tint = uniform(new Color(1, 0.66, 0.25))
  const aspect = uniform(16 / 9)

  const node = Fn(() => {
    const sum = float(0).toVar()

    // Uniform branch: the whole march is skipped when the sun is off-screen
    // (or absent), so views without the sun pay nothing for the effect.
    If(intensity.greaterThan(0.001), () => {
      const screenUv = uv().toConst()
      const delta = sunUv.sub(screenUv).mul(DENSITY / SAMPLES).toConst()
      // Jitter the march start by up to one step so adjacent pixels sample
      // interleaved positions — turns banding into unobtrusive noise.
      const jitter = interleavedGradientNoise(screenCoordinate)
      const pos = screenUv.add(delta.mul(jitter)).toVar()
      const illum = float(1).toVar()

      Loop({ start: 0, end: SAMPLES, type: 'int', condition: '<' }, () => {
        pos.addAssign(delta)
        // Soft emitting disc around the sun, round in pixel space (aspect-corrected).
        const d = pos.sub(sunUv).mul(vec2(aspect, 1)).length()
        const disc = smoothstep(float(SUN_DISC_RADIUS), float(SUN_DISC_RADIUS * 0.3), d)
        // Only sky emits: drawn geometry blocks the disc (see SKY_DEPTH note).
        const depth = depthNode.sample(pos).r
        const sky = reversedDepth
          ? step(depth, float(0)) // 1 only where depth is exactly the 0.0 clear
          : step(float(SKY_DEPTH), depth)
        sum.addAssign(disc.mul(sky).mul(illum))
        illum.mulAssign(DECAY)
      })
    })

    const rays = sum.div(SAMPLES).mul(EXPOSURE).mul(intensity)
    return vec4(tint.mul(rays), 0)
  })()

  return { node, controls: { sunUv, intensity, tint, aspect } }
}
