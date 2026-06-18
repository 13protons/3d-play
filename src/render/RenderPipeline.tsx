import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { RenderPipeline as WebGPURenderPipeline } from 'three/webgpu'
import type { WebGPURenderer } from 'three/webgpu'
import { pass } from 'three/tsl'

/**
 * Render the scene through a WebGPU post-processing node graph instead of the
 * renderer's default direct draw — established from day one so visual effects
 * (tone mapping, bloom, AO, atmosphere, …) can be inserted later by composing onto
 * `outputNode` without touching the render loop.
 *
 * Today the graph is a passthrough: `outputNode = pass(scene, camera)` renders the
 * scene colour straight to the screen. The `pass` honours `camera.layers`, so the
 * vehicle view's single coherent pass draws every enabled layer (base body, terrain
 * overlay, vehicle) into one depth buffer.
 *
 * A positive-priority `useFrame` takes over rendering: once any subscriber has a
 * priority, R3F stops issuing its automatic `gl.render`, leaving the pipeline as the
 * sole renderer. Priority 1 runs after the default (priority 0) camera/controls
 * updates, so the pass renders the current frame's camera.
 */
export function RenderPipeline() {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const pipeline = useMemo(() => {
    const pipeline = new WebGPURenderPipeline(gl)
    pipeline.outputNode = pass(scene, camera)
    return pipeline
  }, [gl, scene, camera])

  useEffect(() => () => pipeline.dispose(), [pipeline])

  useFrame(() => {
    pipeline.render()
  }, 1)

  return null
}
