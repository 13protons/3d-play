/**
 * SPIKE — takram atmosphere FROM ORBIT, floating-origin test.
 *
 * The previous isolation (camera physically at ~6.4e6, identity matrix) was CLEAN.
 * But that doesn't exercise our actual setup: the vehicle scene puts the camera near
 * the scene ORIGIN and relies entirely on worldToECEFMatrix (a translation) to place
 * it at altitude. If that matrix doesn't reach the effect, the camera collapses to
 * the planet centre → every ray is buried in atmosphere → wide maroon "sunset
 * everywhere", exactly the vehicle symptom.
 *
 * So this replicates the vehicle: camera near origin, planet centre far below in
 * scene space, worldToECEFMatrix = translation driven per-frame via
 * context.transientStates (the same path VehicleAtmosphere uses). If THIS maroons,
 * the bug is the matrix/propagation; ?identity=1 falls back to the known-clean
 * camera-at-distance + identity-matrix layout for comparison.
 */
import { useContext, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Vector3 } from 'three'
import { EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { AtmosphereParameters, PrecomputedTexturesGenerator } from '@takram/three-atmosphere'
import type { PrecomputedTextures } from '@takram/three-atmosphere'
import { AerialPerspective, Atmosphere, AtmosphereContext, Sky } from '@takram/three-atmosphere/r3f'
import { Ellipsoid } from '@takram/three-geospatial'

const R = AtmosphereParameters.DEFAULT.bottomRadius // 6_360_000 m
const SPHERE_ELLIPSOID = new Ellipsoid(R, R, R)
const ORBITAL_RADIUS = R + 4e5 // ~400 km orbit
const SUN_DIRECTION = new Vector3(1, 0.15, 0.35).normalize()

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const USE_IDENTITY = params?.get('identity') === '1'
const USE_EFFECT_SKY = params?.get('sky') === 'effect'

// Floating origin: scene origin is the orbital point; the planet centre is far below.
const PLANET_CENTER_SCENE = USE_IDENTITY
  ? new Vector3(0, 0, 0)
  : new Vector3(0, -ORBITAL_RADIUS, 0)
const CAMERA_POSITION: [number, number, number] = USE_IDENTITY
  ? [3.2e6, 1.4e6, 6.4e6]
  : [3e5, 2e5, 3e5]

function usePrecomputedTextures(): PrecomputedTextures | null {
  const gl = useThree((s) => s.gl)
  const [textures, setTextures] = useState<PrecomputedTextures | null>(null)
  useEffect(() => {
    let cancelled = false
    const generator = new PrecomputedTexturesGenerator(gl)
    generator
      .update()
      .then((result) => {
        if (cancelled) {
          generator.dispose()
          return
        }
        console.info('[spike] atmosphere LUTs baked')
        setTextures(result)
      })
      .catch((error) => console.error('[spike] LUT generation failed', error))
    return () => {
      cancelled = true
      generator.dispose({ textures: false })
    }
  }, [gl])
  return textures
}

/** Drives worldToECEFMatrix (translation, floating origin) + sun, exactly like the
 * vehicle's AtmosphereTransientDriver — via context.transientStates each frame. */
function TransientDriver() {
  const context = useContext(AtmosphereContext)
  useFrame(() => {
    const states = context.transientStates
    if (!states) return
    if (USE_IDENTITY) {
      states.worldToECEFMatrix.identity()
    } else {
      states.worldToECEFMatrix.makeTranslation(0, ORBITAL_RADIUS, 0)
    }
    states.sunDirection.copy(SUN_DIRECTION)
  })
  return null
}

function SpikeScene() {
  const textures = usePrecomputedTextures()
  if (!textures) return null

  return (
    <Atmosphere textures={textures} ellipsoid={SPHERE_ELLIPSOID} correctAltitude>
      <TransientDriver />
      {!USE_EFFECT_SKY && <Sky sun={false} moon={false} />}
      <OrbitControls
        makeDefault
        target={PLANET_CENTER_SCENE.toArray()}
        minDistance={R * 1.02}
        maxDistance={R * 4}
      />
      <EffectComposer multisampling={0}>
        <AerialPerspective sky={USE_EFFECT_SKY} sun={false} moon={false} />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Atmosphere>
  )
}

export function AtmosphereSpikePage() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <Canvas camera={{ position: CAMERA_POSITION, near: 1e4, far: 5e7, fov: 50 }}>
        <SpikeScene />
      </Canvas>
      <Overlay />
    </div>
  )
}

function Overlay() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        maxWidth: 400,
        padding: '10px 12px',
        background: 'rgba(0,0,0,0.55)',
        color: '#cde',
        font: '11px/1.5 monospace',
        borderRadius: 6,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>ATMOSPHERE FROM ORBIT — FLOATING-ORIGIN TEST</div>
      <div>
        mode: <b>{USE_IDENTITY ? 'identity matrix + camera at distance (known clean)' : 'floating origin + translation matrix (vehicle setup)'}</b>
      </div>
      <div>sky: <b>{USE_EFFECT_SKY ? 'effect (sky:true)' : 'Sky mesh'}</b></div>
      <div style={{ opacity: 0.7 }}>?identity=1 · ?sky=effect</div>
      <div style={{ marginTop: 6, opacity: 0.75 }}>
        If floating-origin mode is maroon but ?identity=1 is black, the bug is the
        worldToECEFMatrix not reaching the effect (camera collapses to planet centre).
      </div>
    </div>
  )
}
