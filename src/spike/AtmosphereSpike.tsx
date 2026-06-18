/**
 * SPIKE — takram atmosphere FROM ORBIT, in isolation.
 *
 * Question: does takram render correct black space above the limb from an orbital
 * camera, in a CLEAN scene — planet at the origin, worldToECEFMatrix = identity (no
 * floating origin), takram's own analytic ground (no real terrain), no log depth, no
 * manual multi-pass? If it's clean here, the vehicle-scene maroon comes from one of
 * our deviations (real terrain sphere, floating-origin worldToECEFMatrix, sky:true,
 * ground:false, log depth) and we add them back one at a time. If it maroons here
 * too, the from-orbit config itself is the problem.
 *
 * URL toggles (compare configs fast): ?sky=effect (AerialPerspective sky:true, no Sky
 * mesh) vs default (Sky mesh) · ?ground=false (no takram analytic ground).
 */
import { useContext, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Vector3 } from 'three'
import { EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { AtmosphereParameters, PrecomputedTexturesGenerator } from '@takram/three-atmosphere'
import type { PrecomputedTextures } from '@takram/three-atmosphere'
import {
  AerialPerspective,
  Atmosphere,
  AtmosphereContext,
  Sky,
} from '@takram/three-atmosphere/r3f'
import { Ellipsoid } from '@takram/three-geospatial'

const R = AtmosphereParameters.DEFAULT.bottomRadius // 6_360_000 m
const SPHERE_ELLIPSOID = new Ellipsoid(R, R, R)
// Sun off to the side + slightly up, so the view shows a day side, a terminator, and
// space — the regions where the vehicle scene goes maroon.
const SUN_DIRECTION = new Vector3(1, 0.15, 0.35).normalize()

const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
const USE_EFFECT_SKY = params?.get('sky') === 'effect'
const GROUND = params?.get('ground') !== 'false'

/** Bake the Bruneton LUTs on the GPU at runtime. Returns null until done. */
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

/** Fixed sun; worldToECEFMatrix left at identity (scene == ECEF, planet at origin). */
function SunDriver() {
  const context = useContext(AtmosphereContext)
  useFrame(() => {
    const states = context.transientStates
    if (!states) return
    states.sunDirection.copy(SUN_DIRECTION)
  })
  return null
}

function SpikeScene() {
  const textures = usePrecomputedTextures()
  if (!textures) return null

  return (
    <Atmosphere textures={textures} ellipsoid={SPHERE_ELLIPSOID} correctAltitude>
      <SunDriver />
      {!USE_EFFECT_SKY && <Sky sun={false} moon={false} />}
      <OrbitControls makeDefault target={[0, 0, 0]} minDistance={R * 1.02} maxDistance={R * 4} />
      <EffectComposer multisampling={0}>
        <AerialPerspective
          sky={USE_EFFECT_SKY}
          sun={false}
          moon={false}
          ground={GROUND}
        />
        <ToneMapping mode={ToneMappingMode.AGX} />
      </EffectComposer>
    </Atmosphere>
  )
}

export function AtmosphereSpikePage() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <Canvas camera={{ position: [3.2e6, 1.4e6, 6.4e6], near: 1e4, far: 5e7, fov: 50 }}>
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
        maxWidth: 380,
        padding: '10px 12px',
        background: 'rgba(0,0,0,0.55)',
        color: '#cde',
        font: '11px/1.5 monospace',
        borderRadius: 6,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>ATMOSPHERE FROM ORBIT — ISOLATION</div>
      <div>planet at origin · worldToECEF = identity · takram analytic ground</div>
      <div>no floating origin · no real terrain · no log depth</div>
      <div style={{ marginTop: 6 }}>
        sky: <b>{USE_EFFECT_SKY ? 'effect (sky:true)' : 'Sky mesh'}</b> · ground:{' '}
        <b>{GROUND ? 'on' : 'off'}</b>
      </div>
      <div style={{ opacity: 0.7 }}>?sky=effect · ?ground=false</div>
      <div style={{ marginTop: 6, opacity: 0.75 }}>
        Watch: is the space above the limb BLACK (good) or maroon (the bug)? Orbit to
        the terminator — does it read as a clean sunrise?
      </div>
    </div>
  )
}
