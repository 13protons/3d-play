import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RenderPipeline as WebGPURenderPipeline } from 'three/webgpu'
import type { Node, WebGPURenderer } from 'three/webgpu'
import { float, pass, vec3 } from 'three/tsl'
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js'
import { lensflare } from 'three/examples/jsm/tsl/display/LensflareNode.js'
import { useCameraStore } from '../state/camera'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import { buildGodRays, type GodRaysControls } from './godRays'
import { sunScreenState } from './godRaysMath'

/**
 * Render the scene through a WebGPU post-processing node graph instead of the
 * renderer's default direct draw — established from day one so visual effects
 * (tone mapping, bloom, AO, atmosphere, …) can be inserted by composing onto
 * `outputNode` without touching the render loop. The `pass` honours `camera.layers`,
 * so the vehicle view's single coherent pass draws every enabled layer (base body,
 * terrain overlay, vehicle) into one depth buffer.
 *
 * Each effect is opt-in per mount (every mount is its own pipeline instance):
 *  - `withBloom`: scene → bloom, summed back. Thresholded at 2.0 so only genuinely HDR
 *    sources glow: the sun disc (SUN_HDR_GAIN = 40×, see BodyMaterial), the sun's marker
 *    sprite when the disc is sub-threshold-size (EMISSIVE_SPRITE_HDR_GAIN, see Body), and
 *    the brightest stars (~8×, see MagnitudeStars). The threshold sits above the brightest
 *    non-emissive content — the daytime sky and the on-surface atmosphere rim peak near
 *    1.0–1.4 — so the lit ground no longer blooms into a white wash. Wanted in both views.
 *  - `withLensFlare`: samples that bloom to throw ghosts pivoting around screen-centre. Only
 *    sensible standing on the ground (vehicle view); in the orbital map it keys off the bright
 *    HUD markers / node glyphs / orbit lines and smears them into ghosts, so it stays off.
 *    Implies bloom (the flare reads the bloom texture as its bright-source input).
 *  - `withGodRays`: screen-space crepuscular rays marched toward the sun's projected
 *    position, occluded by scene depth (see godRays.ts). The sun's screen uv and an
 *    off-screen fade are updated per frame from the sim state before the pipeline renders.
 *
 * A positive-priority `useFrame` takes over rendering: once any subscriber has a
 * priority, R3F stops issuing its automatic `gl.render`, leaving the pipeline as the
 * sole renderer. Priority 1 runs after the default (priority 0) camera/controls
 * updates, so the pass renders the current frame's camera.
 */
export function RenderPipeline({
  withBloom = false,
  withLensFlare = false,
  withGodRays = false,
  reversedDepth = false,
  godRaysOrigin = 'follow',
}: {
  withBloom?: boolean
  withLensFlare?: boolean
  withGodRays?: boolean
  /** Set when this canvas renders with a reversed-Z depth buffer (vehicle view). */
  reversedDepth?: boolean
  /**
   * Which sim position the scene's floating origin tracks: the camera-store
   * follow target (orbital view) or the active vehicle (vehicle view).
   */
  godRaysOrigin?: 'follow' | 'vehicle'
} = {}) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  const { pipeline, disposables, godRays } = useMemo(() => {
    const pipeline = new WebGPURenderPipeline(gl)
    const scenePass = pass(scene, camera)
    const sceneColor = scenePass.getTextureNode('output')
    // These nodes own GPU render targets that pipeline.dispose() does NOT free (it only disposes
    // the output quad material). Track them so the cleanup below releases them too.
    const disposables: Array<{ dispose: () => void }> = [scenePass]
    let godRays: GodRaysControls | null = null
    let output = sceneColor as ReturnType<typeof sceneColor.add>
    if (withGodRays) {
      const rays = buildGodRays(scenePass.getTextureNode('depth'), { reversedDepth })
      godRays = rays.controls
      // @types/three TSL gap: Fn() returns an untyped Node; it is a valid vec4 producer.
      output = output.add(rays.node as unknown as Node<'color'>)
    }
    if (!withBloom && !withLensFlare) {
      pipeline.outputNode = output
      return { pipeline, disposables, godRays }
    }
    const bloomPass = bloom(sceneColor, 0.8, 0.8, 2.0)
    disposables.push(bloomPass)
    output = output.add(bloomPass)
    if (withLensFlare) {
      const flare = lensflare(bloomPass, {
        ghostTint: vec3(1.0, 0.85, 0.55),
        // @types/three TSL gap: LensflareNodeParams types these as Node, but they accept bare
        // numbers at runtime (wrapped by the node internally). Wrap with float() to satisfy tsc.
        threshold: float(0.7),
        ghostSamples: float(4),
        ghostSpacing: float(0.25),
        ghostAttenuationFactor: float(25),
      })
      disposables.push(flare)
      // @types/three TSL gap: LensflareNode (a TempNode) lacks the Node<"color"> extension
      // members the .add() overload wants. Cast to Node — it is a valid colour-producing node.
      output = output.add(flare as unknown as Node<'color'>)
    }
    pipeline.outputNode = output
    return { pipeline, disposables, godRays }
  }, [gl, scene, camera, withBloom, withLensFlare, withGodRays, reversedDepth])

  useEffect(
    () => () => {
      pipeline.dispose()
      for (const node of disposables) node.dispose()
    },
    [pipeline, disposables],
  )

  useFrame(() => {
    if (godRays) updateGodRaysUniforms(godRays, camera, size.width / size.height, godRaysOrigin)
    pipeline.render()
  }, 1)

  return null
}

const sunTint = /* scratch */ { color: null as null | string }

/**
 * Drive the god-rays uniforms from the sim: project the (emissive body's)
 * position through the floating origin to screen uv, fade rays out as the sun
 * leaves the frustum, and tint them with the sun's own colour.
 */
function updateGodRaysUniforms(
  controls: GodRaysControls,
  camera: Parameters<typeof sunScreenState>[1],
  aspect: number,
  origin: 'follow' | 'vehicle',
): void {
  const store = useTrajectoriesStore.getState()
  const sun = Object.values(store.bodies).find((b) => b.emissive)
  const sunCurve = sun ? store.curves[sun.id] : undefined
  if (!sun || !sunCurve) {
    controls.intensity.value = 0
    return
  }
  const t = store.getSimTime()
  const sunPos = evaluateCurve(sunCurve, t)
  const originId =
    origin === 'vehicle'
      ? Object.keys(store.vehicles)[0]
      : useCameraStore.getState().followTargetId
  const followCurve = originId ? store.curves[originId] : undefined
  const followPos = followCurve ? evaluateCurve(followCurve, t) : [0, 0, 0]
  const { uv, intensity } = sunScreenState(
    [sunPos[0] - followPos[0], sunPos[1] - followPos[1], sunPos[2] - followPos[2]],
    camera,
  )
  // The post quad's uv() is y-down on the WebGPU backend while NDC is y-up —
  // without the flip the rays emanate from a vertically mirrored phantom sun.
  controls.sunUv.value.set(uv[0], 1 - uv[1])
  controls.intensity.value = intensity
  controls.aspect.value = aspect
  if (sunTint.color !== sun.color) {
    sunTint.color = sun.color
    controls.tint.value.set(sun.color)
  }
}
