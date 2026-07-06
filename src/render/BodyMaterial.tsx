import { useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { BackSide, RepeatWrapping, SRGBColorSpace, Vector3 } from 'three'
import type { Texture } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  cameraPosition,
  color,
  cross,
  float,
  mix,
  normalWorldGeometry,
  positionWorld,
  texture,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import type { BodyMeta } from '../state/trajectories'

/**
 * Atmosphere fresnel treatment for the surface material:
 *  - `'limb'` (default): the from-orbit limb glow — a fairly broad, bright rim that reads as
 *    the atmosphere ringing the planet disk. Right for the orbital view and the flying-high
 *    fallback sphere.
 *  - `'haze'`: a thin, gentle distance haze for the surface terrain — concentrated at the
 *    horizon and tinted to the sky's own horizon colour, so far ground softly fades into the
 *    dome instead of ending at a hard line. Avoids the broad blue-white wash `'limb'` produces
 *    on flat grazing ground.
 */
type RimMode = 'limb' | 'haze'

interface BodyMaterialProps {
  body: BodyMeta
  rim?: RimMode
}

// Twilight rim colour (warm) the day-side rim blends toward at the terminator.
const TWILIGHT_RIM: [number, number, number] = [0.74, 0.29, 0.04]

// HDR multiplier for emissive bodies (the Sun). It must sit far above everything else the bloom
// pass sees so the sun reads as overwhelmingly the brightest object — well past the brightest
// stars (which peak ~8× via their own HDR boost) so it doesn't look like just another star.
// Drives the lens flare too (a brighter source → a more dramatic flare). Lit surfaces stay ≤1
// and never reach the 2.0 bloom threshold (see RenderPipeline).
const SUN_HDR_GAIN = 40

// Surface textures are equirectangular and authored in sRGB. Tag the colour space so
// the texture isn't sampled as linear (which over-brightens the day side), and repeat
// U so the longitude seam (UVs running past 1) doesn't smear. V stays clamped at the
// poles. Done on load so we don't mutate the shared cached texture during render.
function configureSurfaceTexture(loaded: Texture | Texture[]): void {
  for (const t of Array.isArray(loaded) ? loaded : [loaded]) {
    t.colorSpace = SRGBColorSpace
    t.wrapS = RepeatWrapping
    t.needsUpdate = true
  }
}

/** Day-side atmosphere rim colour from a body's Rayleigh coefficients (blue-dominant
 * for Earth), normalised and lightened so it reads as sky on the limb. */
function dayRimColor(coefficients: [number, number, number]): [number, number, number] {
  const max = Math.max(coefficients[0], coefficients[1], coefficients[2])
  if (max <= 0) return [0.3, 0.5, 1]
  return coefficients.map((c) => {
    const n = c / max
    return n + (1 - n) * 0.4
  }) as [number, number, number]
}

// The sun's world position is identical for every body material in a given frame, but the lookup
// (Object.values + find emissive) and curve eval would otherwise run once per material per frame.
// Cache it for the frame, keyed by R3F's clock.elapsedTime (set once per frame, unlike getSimTime
// which interpolates off performance.now() per call). Module-level is fine — render is single-threaded.
let sunPosFrame: { key: number; pos: [number, number, number] | null } | undefined

function sunPositionForFrame(frameKey: number): [number, number, number] | null {
  if (sunPosFrame?.key === frameKey) return sunPosFrame.pos
  const store = useTrajectoriesStore.getState()
  const sun = Object.values(store.bodies).find((b) => b.emissive)
  const sunCurve = sun ? store.curves[sun.id] : undefined
  const pos = sunCurve ? (evaluateCurve(sunCurve, store.getSimTime()) as [number, number, number]) : null
  sunPosFrame = { key: frameKey, pos }
  return pos
}

/**
 * Drive a material's `userData.sunDirection` uniform from the sim each frame: the
 * direction from this body to the (emissive) sun. Directions are translation-
 * invariant, so the floating-origin offset drops out. Materials without the uniform
 * (emissive bodies) are skipped. The sun position is resolved once per frame and shared.
 */
function useSunDirectionUniform(bodyId: string, materialRef: RefObject<MeshBasicNodeMaterial | null>): void {
  useFrame((frame) => {
    const material = materialRef.current
    if (!material) return
    const ud = material.userData as {
      sunDirection?: { value: Vector3 }
      sunAngularRadius?: { value: number }
      occluderOffset?: { value: Vector3 }
      occluderRadius?: { value: number }
    }
    const sunDirection = ud.sunDirection
    if (!sunDirection) return
    const sunPos = sunPositionForFrame(frame.clock.elapsedTime)
    const store = useTrajectoriesStore.getState()
    const bodyCurve = store.curves[bodyId]
    if (!sunPos || !bodyCurve) return
    const t = store.getSimTime()
    const bodyPos = evaluateCurve(bodyCurve, t) as [number, number, number]
    const sx = sunPos[0] - bodyPos[0]
    const sy = sunPos[1] - bodyPos[1]
    const sz = sunPos[2] - bodyPos[2]
    const sunDist = Math.hypot(sx, sy, sz) || 1
    sunDirection.value.set(sx / sunDist, sy / sunDist, sz / sunDist)

    // Cast-shadow uniforms: sun angular radius + the dominant sibling occluder
    // (largest angular radius among other non-emissive bodies).
    const sunAngularRadiusU = ud.sunAngularRadius
    const occluderOffsetU = ud.occluderOffset
    const occluderRadiusU = ud.occluderRadius
    if (sunAngularRadiusU && occluderOffsetU && occluderRadiusU) {
      const sun = Object.values(store.bodies).find((b) => b.emissive)
      sunAngularRadiusU.value = sun ? sun.radius / sunDist : 0.00465

      let bestAngular = 0
      let bestOffset: [number, number, number] | null = null
      let bestRadius = 0
      for (const [id, b] of Object.entries(store.bodies)) {
        if (id === bodyId || b.emissive) continue
        const curve = store.curves[id]
        if (!curve) continue
        const p = evaluateCurve(curve, t) as [number, number, number]
        const ox = p[0] - bodyPos[0]
        const oy = p[1] - bodyPos[1]
        const oz = p[2] - bodyPos[2]
        const dist = Math.hypot(ox, oy, oz)
        if (dist === 0) continue
        const angular = b.radius / dist
        if (angular > bestAngular) {
          bestAngular = angular
          bestOffset = [ox, oy, oz]
          bestRadius = b.radius
        }
      }
      if (bestOffset) {
        occluderOffsetU.value.set(bestOffset[0], bestOffset[1], bestOffset[2])
        occluderRadiusU.value = bestRadius
      } else {
        occluderRadiusU.value = 0
      }
    }
  })
}

/**
 * Planet surface material — an unlit node material that shades analytically like the
 * TSL Earth example:
 *  - Emissive bodies (the Sun) render at full albedo, no shading.
 *  - Everyone else gets a day/night terminator: albedo × the sun's elevation over the
 *    surface (smoothstepped), dimming to `minimumLight` on the night side.
 *  - Atmosphere bodies add an on-surface fresnel rim (blue by day → twilight-orange),
 *    tinted from their own scattering coefficients. The off-surface halo is a separate
 *    shell (AtmosphereGlowMaterial).
 */
function buildPlanetMaterial(body: BodyMeta, map: Texture | null, rim: RimMode): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial()
  const albedo = map ? texture(map) : color(body.color)

  if (body.emissive) {
    material.colorNode = albedo.mul(SUN_HDR_GAIN)
    return material
  }

  const sunDirection = uniform(new Vector3(1, 0, 0))
  material.userData.sunDirection = sunDirection
  const sunOrientation = normalWorldGeometry.dot(sunDirection)
  const dayStrength = sunOrientation.smoothstep(-0.25, 0.5)

  // Cast shadows: dim the lit surface where a sibling body eclipses the sun as
  // seen from each fragment — the per-pixel form of sunCoverageFraction, so no
  // ray march. The dominant sibling occluder (its offset from this body's
  // centre + radius) is fed per frame; a zero radius means no caster and the
  // term vanishes. Symmetric by construction: Earth's occluder is the Moon
  // (a solar-eclipse spot sweeps Earth's day side), the Moon's is Earth (the
  // whole Moon darkens in a lunar eclipse). Including the fragment's own offset
  // from centre is what gives the shadow its position and umbra size (the
  // occluder's ~1.7° parallax across the surface).
  const occluderOffset = uniform(new Vector3(0, 0, 0)) // occluder pos − body centre, sim space
  const occluderRadius = uniform(0)
  const sunAngularRadius = uniform(0.00465) // overwritten per frame
  material.userData.occluderOffset = occluderOffset
  material.userData.occluderRadius = occluderRadius
  material.userData.sunAngularRadius = sunAngularRadius

  // Fragment offset from body centre ≈ outward normal × radius (heights are
  // negligible vs the body radius). Scene space is a pure translation of sim
  // space, so this shares orientation with occluderOffset and sunDirection.
  const fragFromCenter = normalWorldGeometry.mul(float(body.radius))
  const toOcc = occluderOffset.sub(fragFromCenter)
  const occDist = toOcc.length()
  const occAngular = occluderRadius.div(occDist)
  const occDir = toOcc.div(occDist)
  // Angular separation of the two disc centres. cross-product magnitude is
  // sin(sep) ≈ sep at these tiny angles, and avoids acos's precision cliff near 1.
  const sep = cross(occDir, sunDirection).length()
  const sumAng = occAngular.add(sunAngularRadius)
  const diffAng = occAngular.sub(sunAngularRadius).abs()
  // Covered fraction of the sun's disc: 0 when clear, ramping to a max of 1
  // (total, occluder ≥ sun) or the area ratio (annular). Matches sunCoverageFraction.
  const maxCoverage = occAngular.mul(occAngular).div(sunAngularRadius.mul(sunAngularRadius).max(float(1e-12))).min(float(1))
  // Ascending edges (smoothstep needs edge0 < edge1): 0 when the discs are
  // concentric (sep ≤ diffAng) → full cover; 1 when clear (sep ≥ sumAng).
  // Invert for coverage.
  const coverage = sep.smoothstep(diffAng, sumAng).oneMinus().mul(maxCoverage)
  const sunlight = coverage.oneMinus()

  let lit = albedo.mul(mix(float(body.minimumLight), float(1), dayStrength.mul(sunlight)))

  const atmosphere = body.atmosphereRender
  if (atmosphere) {
    // fresnel → 1 at grazing incidence (the horizon / the planet's limb); gate to the lit side.
    const fresnel = positionWorld.sub(cameraPosition).normalize().dot(normalWorldGeometry).abs().oneMinus()
    const dayGate = sunOrientation.smoothstep(-0.5, 1)
    if (rim === 'haze') {
      // Thin, gentle horizon haze: high fresnel power keeps it near the limb, low strength keeps
      // it subtle, tinted to the sky's own horizon colour so far ground fades into the dome.
      // @types/three TSL gap: `color()` is typed Node<"color">, which mix() rejects (it wants
      // vec4-or-less). Coerce to vec3 — same runtime value (a colour is a vec3).
      const haze = atmosphere.sky ? vec3(color(atmosphere.sky.horizon)) : vec3(...dayRimColor(atmosphere.rayleigh.coefficients))
      const hazeMix = dayGate.mul(fresnel.pow(3)).mul(0.35).clamp(0, 1)
      lit = mix(lit, haze, hazeMix)
    } else {
      // 'limb': the broad, bright from-orbit limb glow.
      const [dr, dg, db] = dayRimColor(atmosphere.rayleigh.coefficients)
      const atmosphereColor = mix(vec3(...TWILIGHT_RIM), vec3(dr, dg, db), dayStrength)
      const atmosphereMix = dayGate.mul(fresnel.pow(2)).clamp(0, 1)
      lit = mix(lit, atmosphereColor, atmosphereMix)
    }
  }

  material.colorNode = lit
  return material
}

function PlanetMaterial({ body, map, rim }: { body: BodyMeta; map: Texture | null; rim: RimMode }) {
  const materialRef = useRef<MeshBasicNodeMaterial>(null)
  const material = useMemo(() => buildPlanetMaterial(body, map, rim), [body, map, rim])
  useEffect(() => () => material.dispose(), [material])
  useSunDirectionUniform(body.id, materialRef)
  return <primitive object={material} attach="material" ref={materialRef} />
}

export function BodyMaterial({ body, rim = 'limb' }: BodyMaterialProps) {
  if (body.texture) {
    return <TexturedBodyMaterial body={body} texture={body.texture} rim={rim} />
  }
  return <PlanetMaterial body={body} map={null} rim={rim} />
}

function TexturedBodyMaterial({ body, texture: textureUrl, rim }: BodyMaterialProps & { texture: string; rim: RimMode }) {
  const map = useTexture(textureUrl, configureSurfaceTexture)
  return <PlanetMaterial body={body} map={map} rim={rim} />
}

/**
 * Atmosphere halo — a back-side shell (sized to the body radius + atmosphere shell
 * height by the caller) whose alpha is the fresnel limb, gated to the lit side and
 * tinted blue-by-day → twilight-orange. This is the soft glow ringing the planet that
 * the on-surface rim can't produce (it extends past the disk).
 */
function buildAtmosphereGlowMaterial(body: BodyMeta): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial()
  material.side = BackSide
  material.transparent = true
  material.depthWrite = false

  const coefficients = body.atmosphereRender?.rayleigh.coefficients ?? [5.8e-6, 13.5e-6, 33.1e-6]
  const [dr, dg, db] = dayRimColor(coefficients)
  const sunDirection = uniform(new Vector3(1, 0, 0))
  material.userData.sunDirection = sunDirection
  const sunOrientation = normalWorldGeometry.dot(sunDirection)
  const dayStrength = sunOrientation.smoothstep(-0.25, 0.5)
  const atmosphereColor = mix(vec3(...TWILIGHT_RIM), vec3(dr, dg, db), dayStrength)
  const fresnel = positionWorld.sub(cameraPosition).normalize().dot(normalWorldGeometry).abs().oneMinus()
  // TSL remap does NOT clamp: below the limb band (fresnel < 0.73) it extrapolates
  // alpha past 1 — up to ~3.7 at the shell's centre, ~50 after pow(3). From orbit the
  // planet's disc hides that region, but from far away depth precision collapses and
  // the shell's interior wins the depth test in bands, blasting an HDR glare through
  // the bloom pass (the "blown-out white disc with banding" seen from the Moon).
  // Clamp the band, and fade the glow to zero on the interior side — it's a limb
  // phenomenon; nothing inward of the limb should glow.
  const limbBand = fresnel.remap(0.73, 1, 1, 0).clamp(0, 1)
  const interiorFade = fresnel.smoothstep(0.45, 0.7)
  const alpha = limbBand.pow(3).mul(interiorFade).mul(sunOrientation.smoothstep(-0.5, 1))
  material.outputNode = vec4(atmosphereColor, alpha)
  return material
}

export function AtmosphereGlowMaterial({ body }: BodyMaterialProps) {
  const materialRef = useRef<MeshBasicNodeMaterial>(null)
  const material = useMemo(() => buildAtmosphereGlowMaterial(body), [body])
  useEffect(() => () => material.dispose(), [material])
  useSunDirectionUniform(body.id, materialRef)
  return <primitive object={material} attach="material" ref={materialRef} />
}
