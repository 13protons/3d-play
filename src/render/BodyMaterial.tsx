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

// HDR multiplier for emissive bodies (the Sun): pushes the disc above 1.0 so the pipeline's
// bloom (thresholded at 1.0) catches the sun and nothing else — lit surfaces stay ≤1 and don't
// bloom. Drives the lens flare too.
const SUN_HDR_GAIN = 4

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

/**
 * Drive a material's `userData.sunDirection` uniform from the sim each frame: the
 * direction from this body to the (emissive) sun. Directions are translation-
 * invariant, so the floating-origin offset drops out. Materials without the uniform
 * (emissive bodies) are skipped.
 */
function useSunDirectionUniform(bodyId: string, materialRef: RefObject<MeshBasicNodeMaterial | null>): void {
  useFrame(() => {
    const sunDirection = materialRef.current?.userData.sunDirection as { value: Vector3 } | undefined
    if (!sunDirection) return
    const store = useTrajectoriesStore.getState()
    const sun = Object.values(store.bodies).find((b) => b.emissive)
    const sunCurve = sun ? store.curves[sun.id] : undefined
    const bodyCurve = store.curves[bodyId]
    if (!sun || !sunCurve || !bodyCurve) return
    const t = store.getSimTime()
    const sunPos = evaluateCurve(sunCurve, t) as [number, number, number]
    const bodyPos = evaluateCurve(bodyCurve, t) as [number, number, number]
    sunDirection.value.set(sunPos[0] - bodyPos[0], sunPos[1] - bodyPos[1], sunPos[2] - bodyPos[2]).normalize()
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
  let lit = albedo.mul(mix(float(body.minimumLight), float(1), dayStrength))

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
  const alpha = fresnel.remap(0.73, 1, 1, 0).pow(3).mul(sunOrientation.smoothstep(-0.5, 1))
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
