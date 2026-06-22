import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RenderPipeline as WebGPURenderPipeline } from 'three/webgpu'
import type { WebGPURenderer } from 'three/webgpu'
import { pass, vec3 } from 'three/tsl'
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js'
import { lensflare } from 'three/examples/jsm/tsl/display/LensflareNode.js'

/**
 * Render the scene through a WebGPU post-processing node graph instead of the
 * renderer's default direct draw — established from day one so visual effects
 * (tone mapping, bloom, AO, atmosphere, …) can be inserted by composing onto
 * `outputNode` without touching the render loop. The `pass` honours `camera.layers`,
 * so the vehicle view's single coherent pass draws every enabled layer (base body,
 * terrain overlay, vehicle) into one depth buffer.
 *
 * Each effect is opt-in per mount (every mount is its own pipeline instance):
 *  - `withBloom`: scene → bloom, summed back. Thresholded at 2.0 so only the HDR sun disc
 *    glows (rendered at SUN_HDR_GAIN = 4×, see BodyMaterial). The threshold sits above the
 *    brightest non-sun content — the daytime sky and the on-surface atmosphere rim peak near
 *    1.0–1.4 — so the lit ground no longer blooms into a white wash. Wanted in both views.
 *  - `withLensFlare`: samples that bloom to throw ghosts pivoting around screen-centre. Only
 *    sensible standing on the ground (vehicle view); in the orbital map it keys off the bright
 *    HUD markers / node glyphs / orbit lines and smears them into ghosts, so it stays off.
 *    Implies bloom (the flare reads the bloom texture as its bright-source input).
 *
 * A positive-priority `useFrame` takes over rendering: once any subscriber has a
 * priority, R3F stops issuing its automatic `gl.render`, leaving the pipeline as the
 * sole renderer. Priority 1 runs after the default (priority 0) camera/controls
 * updates, so the pass renders the current frame's camera.
 */
export function RenderPipeline({
  withBloom = false,
  withLensFlare = false,
}: {
  withBloom?: boolean
  withLensFlare?: boolean
} = {}) {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const pipeline = useMemo(() => {
    const pipeline = new WebGPURenderPipeline(gl)
    const scenePass = pass(scene, camera)
    const sceneColor = scenePass.getTextureNode('output')
    if (!withBloom && !withLensFlare) {
      pipeline.outputNode = sceneColor
      return pipeline
    }
    const bloomPass = bloom(sceneColor, 0.8, 0.8, 2.0)
    let output = sceneColor.add(bloomPass)
    if (withLensFlare) {
      const flare = lensflare(bloomPass, {
        ghostTint: vec3(1.0, 0.85, 0.55),
        threshold: 0.7,
        ghostSamples: 4,
        ghostSpacing: 0.25,
        ghostAttenuationFactor: 25,
      })
      output = output.add(flare)
    }
    pipeline.outputNode = output
    return pipeline
  }, [gl, scene, camera, withBloom, withLensFlare])

  useEffect(() => () => pipeline.dispose(), [pipeline])

  useFrame(() => {
    pipeline.render()
  }, 1)

  return null
}
