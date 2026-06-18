import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { PointsMaterial } from 'three'
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js'
import { uniform } from 'three/tsl'
import { makeWebGPURenderer } from '../render/webgpuRenderer'
import { RenderPipeline } from '../render/RenderPipeline'
import { createStarfieldGeometry } from '../render/sky/starfieldGeometry'

// The reference sphere doubles as the "planet": camera altitude above it drives the
// atmosphere, and the shell is where the sky thins to space.
const PLANET_RADIUS = 2
const SHELL_HEIGHT = 8

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

/**
 * Isolated spike for the SkyMesh atmosphere approach, reproducing the vehicle canvas
 * (WebGPURenderer + reversedDepthBuffer + our node RenderPipeline). The sky is an
 * opaque, depth-test-OFF, low-renderOrder, camera-attached background dome — so
 * SkyMesh's `z = w` far-plane trick is ignored and reversed-Z doesn't bite — and the
 * Preetham colour is multiplied by a single "sky strength" = atmosphere × dayness:
 *
 *  - atmosphere: from the camera's altitude above the planet (0 in space, 1 near the
 *    surface), so zooming out thins the sky to space.
 *  - dayness: from sun elevation (0 below the horizon), because Preetham never goes to
 *    night on its own. Stars reappear as sky strength drops, so night and space both
 *    show stars while daytime washes them out.
 */
function SpikeAtmosphere({ sunElevation }: { sunElevation: number }) {
  const camera = useThree((s) => s.camera)
  const skyRef = useRef<SkyMesh>(null)
  const starsMaterialRef = useRef<PointsMaterial>(null)
  const sky = useMemo(() => {
    const mesh = new SkyMesh()
    mesh.turbidity.value = 10
    mesh.rayleigh.value = 2
    mesh.mieCoefficient.value = 0.005
    mesh.mieDirectionalG.value = 0.8
    const strength = uniform(0)
    mesh.userData.strength = strength
    if (mesh.material.colorNode) {
      mesh.material.colorNode = mesh.material.colorNode.mul(strength)
    }
    mesh.material.depthTest = false
    mesh.material.depthWrite = false
    mesh.renderOrder = -1
    mesh.frustumCulled = false
    mesh.scale.setScalar(1e6)
    return mesh
  }, [])
  const starGeometry = useMemo(() => createStarfieldGeometry(1e8, 2000), [])

  useFrame(() => {
    const altitude = camera.position.length() - PLANET_RADIUS
    const atmosphere = smoothstep(SHELL_HEIGHT, 0, altitude)
    const dayness = smoothstep(-0.05, 0.25, Math.sin(sunElevation))
    const strength = atmosphere * dayness

    const mesh = skyRef.current
    if (mesh) {
      ;(mesh.userData.strength as { value: number }).value = strength
      mesh.position.copy(camera.position)
      mesh.sunPosition.value.set(Math.cos(sunElevation) * 4e5, Math.sin(sunElevation) * 4e5, 0)
    }
    const starsMaterial = starsMaterialRef.current
    if (starsMaterial) {
      const opacity = clamp01(1 - strength)
      starsMaterial.opacity = opacity
      starsMaterial.visible = opacity > 0.01
    }
  })

  return (
    <>
      <primitive object={sky} ref={skyRef} />
      <points geometry={starGeometry}>
        <pointsMaterial ref={starsMaterialRef} size={1.5} sizeAttenuation={false} color="#ffffff" transparent depthWrite={false} />
      </points>
    </>
  )
}

function SpikeScene({ sunElevation }: { sunElevation: number }) {
  return (
    <>
      <RenderPipeline />
      <SpikeAtmosphere sunElevation={sunElevation} />
      {/* The reference sphere is the "planet": confirms the sky sits behind solid,
          depth-tested geometry, and gives the camera something to orbit. */}
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} />
      <mesh>
        <sphereGeometry args={[PLANET_RADIUS, 64, 48]} />
        <meshStandardMaterial color="#6f8f6a" />
      </mesh>
      <OrbitControls minDistance={PLANET_RADIUS * 1.05} maxDistance={40} />
    </>
  )
}

export function SkySpikePage() {
  const [sunElevation, setSunElevation] = useState(0.6)
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <Canvas
        camera={{ position: [0, 2, 6], near: 0.1, far: 1e9, fov: 60 }}
        gl={makeWebGPURenderer({ reversedDepthBuffer: true })}
      >
        <SpikeScene sunElevation={sunElevation} />
      </Canvas>
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          padding: 12,
          background: 'rgba(0,0,0,0.6)',
          color: '#ddd',
          font: '12px monospace',
          borderRadius: 6,
          maxWidth: 260,
        }}
      >
        <div>SkyMesh spike — WebGPU + reversed-Z + RenderPipeline</div>
        <label style={{ display: 'block', marginTop: 10 }}>
          sun elevation {sunElevation.toFixed(2)}
          <input
            type="range"
            min={-0.4}
            max={1.57}
            step={0.01}
            value={sunElevation}
            onChange={(e) => setSunElevation(Number(e.target.value))}
            style={{ width: 220, display: 'block' }}
          />
        </label>
        <div style={{ marginTop: 10, opacity: 0.7 }}>
          Zoom out → atmosphere thins to space (stars). Lower the sun → sky darkens to night
          (stars return). Daytime washes stars out.
        </div>
      </div>
    </div>
  )
}
