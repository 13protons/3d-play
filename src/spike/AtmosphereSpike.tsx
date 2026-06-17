/**
 * SPIKE — takram `@takram/three-atmosphere` + pmndrs `postprocessing` integration probe.
 *
 * Purpose (see docs/atmosphere-rendering-research-2026-06-17.md): de-risk adopting
 * takram's Bruneton-precomputed atmosphere on a real post-processing pipeline BEFORE
 * the full VehicleScene refactor. This route is deliberately ISOLATED from the working
 * flight renderer ("alongside, not replacing") so it can't break play.
 *
 * What it proves / measures:
 *   1. Does takram render at all in our exact stack — R3F 9.5, three r0.183, WebGL2,
 *      with LUTs generated AT RUNTIME (no CDN/EXR fetch) via PrecomputedTexturesGenerator?
 *   2. Aerial-perspective compositing over real geometry depth (scene × transmittance
 *      + inscatter), at real Earth metre scale, placed via worldToECEFMatrix (floating
 *      origin: scene origin sits on the planet surface, camera near origin).
 *   3. THE depth tension. The flight renderer clears the depth buffer between the
 *      planet pass and the vehicle pass to stop a 6,360 km planet and a ~10 m vehicle
 *      from sharing — and z-fighting in — one depth buffer under near:0.1 far:1e9.
 *      takram's AerialPerspectiveEffect reconstructs world position from a SINGLE
 *      coherent depth buffer, so the refactor must drop that depth clear. This spike
 *      puts a real-scale planet AND a multi-part near vehicle under one coherent depth
 *      buffer to see whether (a) the vehicle parts self-z-fight and (b) the planet
 *      surface jitters — and whether `?log=1` (logarithmicDepthBuffer) fixes the
 *      z-fighting WITHOUT breaking takram's depth → position reconstruction.
 *
 * Toggle: append `?log=1` to the URL to enable a logarithmic depth buffer.
 */
import { useContext, useEffect, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Vector3 } from 'three'
import { EffectComposer } from '@react-three/postprocessing'
import {
  AtmosphereParameters,
  PrecomputedTexturesGenerator,
} from '@takram/three-atmosphere'
import type { PrecomputedTextures } from '@takram/three-atmosphere'
import {
  AerialPerspective,
  Atmosphere,
  AtmosphereContext,
  SunLight,
} from '@takram/three-atmosphere/r3f'
import { Ellipsoid } from '@takram/three-geospatial'

// Ground sphere + surface anchor MUST match the atmosphere's bottom radius, else the
// "surface" floats above or below where the scattering math expects it. takram's
// Bruneton default uses 6,360 km (NOT Earth's 6,371 km mean radius).
const R = AtmosphereParameters.DEFAULT.bottomRadius // 6_360_000 m
// Perfect sphere ellipsoid so geodetic up == radial up everywhere (WGS84 would
// introduce an oblateness mismatch against our spherical ground mesh).
const SPHERE_ELLIPSOID = new Ellipsoid(R, R, R)

// Floating origin: the scene origin is a point on the surface, on the ECEF +Y axis
// so the local "up" (surface normal) coincides with ECEF +Y and NO rotation is
// needed — worldToECEFMatrix is a pure translation by this anchor.
const ANCHOR_ECEF = new Vector3(0, R, 0)

// Sun ~8° above the horizon toward scene +X — a low angle gives the longest
// atmospheric path and the most dramatic Rayleigh/Mie scattering to eyeball.
const SUN_ELEVATION = (16 * Math.PI) / 180
const SUN_DIRECTION_ECEF = new Vector3(
  Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  0,
).normalize()

const USE_LOG_DEPTH =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('log') === '1'

/** Bake the Bruneton LUTs on the GPU at runtime (transmittance / scattering /
 * irradiance / multi-scatter). Returns null until the bake completes. */
function usePrecomputedTextures(): PrecomputedTextures | null {
  const gl = useThree((s) => s.gl)
  const [textures, setTextures] = useState<PrecomputedTextures | null>(null)

  useEffect(() => {
    let cancelled = false
    const generator = new PrecomputedTexturesGenerator(gl)
    const floatSupported = !!gl.getContext().getExtension('EXT_color_buffer_float')
    if (!floatSupported) {
      console.warn(
        '[spike] EXT_color_buffer_float unavailable — float LUT bake may fail',
      )
    }
    generator
      .update()
      .then((result) => {
        if (cancelled) {
          generator.dispose()
          return
        }
        console.info('[spike] atmosphere LUTs baked', result)
        setTextures(result)
      })
      .catch((error) => {
        console.error('[spike] LUT generation failed', error)
      })
    return () => {
      cancelled = true
      // Free the scratch render targets; keep the result textures we handed to state.
      generator.dispose({ textures: false })
    }
  }, [gl])

  return textures
}

/** Drives the Atmosphere context's transient state. Static scene, so a fixed sun +
 * a fixed world→ECEF translation; written every frame so the provider can't reset it. */
function TransientStateDriver() {
  const context = useContext(AtmosphereContext)
  useFrame(() => {
    const states = context.transientStates
    if (!states) return
    states.worldToECEFMatrix.makeTranslation(
      ANCHOR_ECEF.x,
      ANCHOR_ECEF.y,
      ANCHOR_ECEF.z,
    )
    states.sunDirection.copy(SUN_DIRECTION_ECEF)
  })
  return null
}

/**
 * Real-scale planet, centred so its surface touches the scene origin. Heavily
 * tessellated: at low segment counts the faceted limb sags kilometres below the true
 * horizon (≈ R·½·(π/N)²), exposing a dark grazing-ground sliver = a black horizon
 * seam. This is a single-sphere limitation, NOT a takram artifact — the real renderer
 * draws near ground with tiled terrain (PlanetTerrainTiles), so the limb is the tile
 * LOD's job, not a sphere's. High N here just keeps the spike's horizon clean.
 */
function Ground() {
  return (
    <mesh position={[0, -R, 0]}>
      <sphereGeometry args={[R, 1024, 512]} />
      <meshStandardMaterial color="#41633f" roughness={1} metalness={0} />
    </mesh>
  )
}

/**
 * A small multi-part "vehicle": thin plates stacked with clean AIR GAPS between every
 * face, plus a body cylinder whose base sits clear above the top plate (no coincident
 * or interpenetrating surfaces). Lifted off the ground so nothing is coplanar with it.
 * This isolates the only question that matters for the refactor: does depth-PRECISION
 * z-fighting occur between close, parallel, *separated* faces under near:0.1 far:1e9 —
 * which logarithmic depth would fix — vs. coincident-geometry fighting, which it can't.
 */
function TestVehicle() {
  return (
    <group position={[0, 3, 0]}>
      {/* plate spans (height 0.08): [-0.04,0.04] · [0.20,0.28] · [0.44,0.52] — 16 cm gaps */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[2.4, 0.08, 2.4]} />
        <meshStandardMaterial color="#dddddd" />
      </mesh>
      <mesh position={[0, 0.24, 0]}>
        <boxGeometry args={[2.0, 0.08, 2.0]} />
        <meshStandardMaterial color="#cc3333" />
      </mesh>
      <mesh position={[0, 0.48, 0]}>
        <boxGeometry args={[1.6, 0.08, 1.6]} />
        <meshStandardMaterial color="#33aa33" />
      </mesh>
      {/* base at y=0.6 (8 cm above the top plate), base radius 0.7 < plate half-width 0.8 */}
      <mesh position={[0, 2.6, 0]}>
        <cylinderGeometry args={[0.5, 0.7, 4, 16]} />
        <meshStandardMaterial color="#cccccc" metalness={0.3} roughness={0.6} />
      </mesh>
    </group>
  )
}

function SpikeScene() {
  const textures = usePrecomputedTextures()
  if (!textures) return null // still baking the LUTs

  return (
    <Atmosphere
      textures={textures}
      ellipsoid={SPHERE_ELLIPSOID}
      correctAltitude
    >
      <TransientStateDriver />
      <Ground />
      <TestVehicle />
      <SunLight />
      <ambientLight intensity={0.02} />
      {/* Target the vehicle so you orbit/zoom it directly (zoom in to inspect the
          12 cm plate gaps for self-z-fighting); the low camera keeps the horizon
          + scattering in the upper frame so near object and sky are seen together. */}
      <OrbitControls
        makeDefault
        target={[0, 4, 0]}
        minDistance={3}
        maxDistance={5e5}
      />
      {/* The effect both renders the sky (sky) into background pixels AND fogs
          geometry by reconstructed depth — one coherent pass, no separate Sky mesh. */}
      <EffectComposer>
        <AerialPerspective sky sunLight skyLight />
      </EffectComposer>
    </Atmosphere>
  )
}

export function AtmosphereSpikePage() {
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <Canvas
        camera={{ position: [11, 7, 15], near: 0.1, far: 1e9, fov: 60 }}
        gl={{ logarithmicDepthBuffer: USE_LOG_DEPTH }}
      >
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
        maxWidth: 360,
        padding: '10px 12px',
        background: 'rgba(0,0,0,0.55)',
        color: '#cde',
        font: '11px/1.5 monospace',
        borderRadius: 6,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 4 }}>ATMOSPHERE SPIKE</div>
      <div>takram (Bruneton LUTs, runtime-baked) + pmndrs postprocessing</div>
      <div>real-scale planet ({(R / 1000).toFixed(0)} km) + near multi-part vehicle</div>
      <div style={{ marginTop: 6 }}>
        depth buffer: <b>{USE_LOG_DEPTH ? 'logarithmic' : 'standard'}</b>
      </div>
      <div style={{ opacity: 0.7 }}>
        {USE_LOG_DEPTH ? 'drop ?log=1 for standard' : 'add ?log=1 to test log depth'}
      </div>
      <div style={{ marginTop: 6, opacity: 0.7 }}>
        Watch for: vehicle self-z-fighting · planet surface jitter · sky/horizon
        compositing · whether log depth keeps aerial perspective correct.
      </div>
    </div>
  )
}
