/**
 * SPIKE — takram atmosphere FROM ORBIT.
 *
 * The analytic-ground version was clean, but it never exercised the vehicle's real
 * path: with takram's analytic ground, EVERY pixel hits the background SKY branch.
 * The vehicle has REAL geometry (terrain/body sphere) writing depth, ground:false,
 * and far:1e9. So this mirrors the vehicle: a real lit ground sphere at the planet
 * centre, ground:false, far:1e9, floating-origin translation matrix driven via
 * context.transientStates. If THIS maroons, it's the real-geometry + far-precision
 * path (the SKY/geometry depth detection), not the matrix or sky config.
 *
 * Toggles: ?analytic=1 (takram analytic ground + far:5e7, the known-clean case) ·
 * ?sky=effect (sky:true instead of Sky mesh) · ?identity=1 (camera-at-distance).
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
const ORBITAL_RADIUS = R + 4e5
const SUN_DIRECTION = new Vector3(1, 0.15, 0.35).normalize()

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const USE_IDENTITY = params?.get('identity') === '1'
const USE_EFFECT_SKY = params?.get('sky') === 'effect'
const USE_ANALYTIC = params?.get('analytic') === '1' // takram analytic ground, no real geometry
const USE_LINEAR = params?.get('linear') === '1' // far:1e9 linear depth (the trash baseline)

// Default: reversed-Z depth (takram's LEO approach) with far:1e9 — excellent
// precision across the whole range so the real planet doesn't z-fight, while the
// distant sun can still render. ?linear=1 is the broken linear-depth baseline.
const USE_REVERSED_Z = !USE_LINEAR && !USE_ANALYTIC
const PLANET_CENTER_SCENE = USE_IDENTITY ? new Vector3(0, 0, 0) : new Vector3(0, -ORBITAL_RADIUS, 0)
const CAMERA_POSITION: [number, number, number] = USE_IDENTITY ? [3.2e6, 1.4e6, 6.4e6] : [3e5, 2e5, 3e5]
const NEAR = USE_ANALYTIC ? 1e4 : 0.1
const FAR = USE_ANALYTIC ? 5e7 : 1e9

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

function TransientDriver() {
  const context = useContext(AtmosphereContext)
  useFrame(() => {
    const states = context.transientStates
    if (!states) return
    if (USE_IDENTITY) states.worldToECEFMatrix.identity()
    else states.worldToECEFMatrix.makeTranslation(0, ORBITAL_RADIUS, 0)
    states.sunDirection.copy(SUN_DIRECTION)
  })
  return null
}

export function AtmosphereSpikePage() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <Canvas
        camera={{ position: CAMERA_POSITION, near: NEAR, far: FAR, fov: 50 }}
        gl={USE_REVERSED_Z ? { reversedDepthBuffer: true } : undefined}
      >
        <SpikeScene />
      </Canvas>
      <Overlay />
    </div>
  )
}

function SpikeScene() {
  const textures = usePrecomputedTextures()
  if (!textures) return null

  return (
    <Atmosphere textures={textures} ellipsoid={SPHERE_ELLIPSOID} correctAltitude>
      <TransientDriver />
      {!USE_EFFECT_SKY && <Sky sun={false} moon={false} />}
      {!USE_ANALYTIC && (
        <>
          {/* Real lit planet sphere — exercises the geometry-depth path like the vehicle. */}
          <mesh position={PLANET_CENTER_SCENE.toArray()}>
            <sphereGeometry args={[R, 256, 128]} />
            <meshStandardMaterial color="#3a6f4a" roughness={1} metalness={0} />
          </mesh>
          <directionalLight position={SUN_DIRECTION.clone().multiplyScalar(1e8).toArray()} intensity={3} />
          <ambientLight intensity={0.05} />
        </>
      )}
      <OrbitControls makeDefault target={PLANET_CENTER_SCENE.toArray()} minDistance={R * 1.02} maxDistance={R * 4} />
      <EffectComposer multisampling={0}>
        <AerialPerspective sky={USE_EFFECT_SKY} sun={false} moon={false} ground={USE_ANALYTIC} />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Atmosphere>
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
      <div style={{ fontWeight: 700, marginBottom: 4 }}>ATMOSPHERE FROM ORBIT</div>
      <div>
        depth: <b>{USE_ANALYTIC ? 'far 5e7 (analytic, no geometry)' : USE_REVERSED_Z ? 'REVERSED-Z, far 1e9' : 'linear, far 1e9 (baseline)'}</b>
      </div>
      <div>
        ground: <b>{USE_ANALYTIC ? 'takram analytic' : 'REAL sphere + ground:false'}</b> · sky:{' '}
        <b>{USE_EFFECT_SKY ? 'effect' : 'mesh'}</b>
      </div>
      <div style={{ opacity: 0.7 }}>?linear=1 · ?analytic=1 · ?sky=effect · ?identity=1</div>
      <div style={{ marginTop: 6, opacity: 0.75 }}>
        Default = reversed-Z (takram's LEO fix): real planet should be smooth (no
        z-fighting) with far:1e9. ?linear=1 is the broken baseline for comparison.
      </div>
    </div>
  )
}
