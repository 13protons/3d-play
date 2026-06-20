import { useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { BackSide, Mesh, SphereGeometry, TextureLoader, SRGBColorSpace, Vector3 } from 'three'
import type { DirectionalLight } from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import {
  bumpMap,
  cameraPosition,
  color,
  max,
  mix,
  normalWorldGeometry,
  output,
  positionWorld,
  step,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl'
import { makeWebGPURenderer } from '../render/webgpuRenderer'
import { RenderPipeline } from '../render/RenderPipeline'

// CORS-friendly mirror of three's example planet textures (jsdelivr sends ACAO: *).
// A spike-only convenience — production would ship/license its own maps.
const TEXTURE_BASE = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/textures/planets/'

/**
 * Spike: a faithful port of three's `webgpu_tsl_earth` example into our stack
 * (WebGPURenderer + node RenderPipeline). It's a globe-from-space renderer — day/night
 * terminator with city lights, clouds + bump + ocean roughness from a packed texture,
 * and a fresnel atmosphere rim (blue by day, orange at the terminator). Distinct from
 * our SkyMesh (sky from *inside* the atmosphere); this is the planet itself. Drag the
 * sun slider to sweep the terminator; orbit with the mouse.
 */
function EarthGlobe({ sunAzimuth }: { sunAzimuth: number }) {
  const globeRef = useRef<Mesh>(null)
  const lightRef = useRef<DirectionalLight>(null)

  const built = useMemo(() => {
    const loader = new TextureLoader()
    const dayTexture = loader.load(`${TEXTURE_BASE}earth_day_4096.jpg`)
    dayTexture.colorSpace = SRGBColorSpace
    dayTexture.anisotropy = 8
    const nightTexture = loader.load(`${TEXTURE_BASE}earth_night_4096.jpg`)
    nightTexture.colorSpace = SRGBColorSpace
    nightTexture.anisotropy = 8
    const bumpRoughnessCloudsTexture = loader.load(`${TEXTURE_BASE}earth_bump_roughness_clouds_4096.jpg`)
    bumpRoughnessCloudsTexture.anisotropy = 8

    const sunDirection = uniform(new Vector3(1, 0, 0))
    const atmosphereDayColor = uniform(color('#4db2ff'))
    const atmosphereTwilightColor = uniform(color('#bc490b'))
    const roughnessLow = uniform(0.25)
    const roughnessHigh = uniform(0.35)

    // View-dependent rim term, and how lit a fragment is by the sun.
    const fresnel = positionWorld.sub(cameraPosition).normalize().dot(normalWorldGeometry).abs().oneMinus().toVar()
    const sunOrientation = normalWorldGeometry.dot(sunDirection).toVar()
    const atmosphereColor = mix(atmosphereTwilightColor, atmosphereDayColor, sunOrientation.smoothstep(-0.25, 0.5))

    const globeMaterial = new MeshStandardNodeMaterial()
    const cloudsStrength = texture(bumpRoughnessCloudsTexture, uv()).b.smoothstep(0.2, 1)
    globeMaterial.colorNode = mix(texture(dayTexture), vec3(1), cloudsStrength.mul(2))
    const roughness = max(texture(bumpRoughnessCloudsTexture).g, step(0.01, cloudsStrength))
    globeMaterial.roughnessNode = roughness.remap(0, 1, roughnessLow, roughnessHigh)
    const night = texture(nightTexture)
    const dayStrength = sunOrientation.smoothstep(-0.25, 0.5)
    const atmosphereDayStrength = sunOrientation.smoothstep(-0.5, 1)
    const atmosphereMix = atmosphereDayStrength.mul(fresnel.pow(2)).clamp(0, 1)
    let finalOutput = mix(night.rgb, output.rgb, dayStrength)
    finalOutput = mix(finalOutput, atmosphereColor, atmosphereMix)
    globeMaterial.outputNode = vec4(finalOutput, output.a)
    const bumpElevation = max(texture(bumpRoughnessCloudsTexture).r, cloudsStrength)
    globeMaterial.normalNode = bumpMap(bumpElevation)

    // Atmosphere rim: a back-side shell whose alpha is the fresnel edge, gated by how
    // lit the limb is, tinted day-blue → twilight-orange like the surface rim.
    const atmosphereMaterial = new MeshBasicNodeMaterial({ side: BackSide, transparent: true })
    const rimAlpha = fresnel.remap(0.73, 1, 1, 0).pow(3).mul(sunOrientation.smoothstep(-0.5, 1))
    atmosphereMaterial.outputNode = vec4(atmosphereColor, rimAlpha)

    const geometry = new SphereGeometry(1, 128, 64)
    const globe = new Mesh(geometry, globeMaterial)
    globe.userData.sunDirection = sunDirection
    const atmosphere = new Mesh(geometry, atmosphereMaterial)
    atmosphere.scale.setScalar(1.04)

    return { globe, atmosphere, sunDirection }
  }, [])

  useFrame(() => {
    const sun = new Vector3(Math.cos(sunAzimuth), 0.2, Math.sin(sunAzimuth)).normalize()
    const globe = globeRef.current
    if (globe) (globe.userData.sunDirection as { value: Vector3 }).value.copy(sun)
    lightRef.current?.position.copy(sun).multiplyScalar(10)
  })

  return (
    <>
      <directionalLight ref={lightRef} intensity={2} />
      <primitive object={built.globe} ref={globeRef} />
      <primitive object={built.atmosphere} />
    </>
  )
}

function EarthScene({ sunAzimuth }: { sunAzimuth: number }) {
  return (
    <>
      <RenderPipeline />
      <EarthGlobe sunAzimuth={sunAzimuth} />
      <OrbitControls minDistance={1.3} maxDistance={8} />
    </>
  )
}

export function EarthSpikePage() {
  const [sunAzimuth, setSunAzimuth] = useState(2.2)
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <Canvas camera={{ position: [0, 0.6, 3], near: 0.1, far: 100, fov: 45 }} gl={makeWebGPURenderer()}>
        <EarthScene sunAzimuth={sunAzimuth} />
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
          maxWidth: 280,
        }}
      >
        <div>TSL Earth spike — globe from space (day/night, clouds, atmosphere rim)</div>
        <label style={{ display: 'block', marginTop: 10 }}>
          sun azimuth {sunAzimuth.toFixed(2)}
          <input
            type="range"
            min={0}
            max={6.28}
            step={0.01}
            value={sunAzimuth}
            onChange={(e) => setSunAzimuth(Number(e.target.value))}
            style={{ width: 240, display: 'block' }}
          />
        </label>
        <div style={{ marginTop: 10, opacity: 0.7 }}>
          Sweep the sun to see the terminator: lit day side (clouds + ocean glint), city
          lights on the night side, and the blue→orange atmosphere rim. Textures stream
          from a CDN, so give them a moment.
        </div>
      </div>
    </div>
  )
}
