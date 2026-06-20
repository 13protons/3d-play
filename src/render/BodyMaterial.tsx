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

interface BodyMaterialProps {
  body: BodyMeta
}

// Twilight rim colour (warm) the day-side rim blends toward at the terminator.
const TWILIGHT_RIM: [number, number, number] = [0.74, 0.29, 0.04]

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
function buildPlanetMaterial(body: BodyMeta, map: Texture | null): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial()
  const albedo = map ? texture(map) : color(body.color)

  if (body.emissive) {
    material.colorNode = albedo
    return material
  }

  const sunDirection = uniform(new Vector3(1, 0, 0))
  material.userData.sunDirection = sunDirection
  const sunOrientation = normalWorldGeometry.dot(sunDirection)
  const dayStrength = sunOrientation.smoothstep(-0.25, 0.5)
  let lit = albedo.mul(mix(float(body.minimumLight), float(1), dayStrength))

  const atmosphere = body.atmosphereRender
  if (atmosphere) {
    const [dr, dg, db] = dayRimColor(atmosphere.rayleigh.coefficients)
    const atmosphereColor = mix(vec3(...TWILIGHT_RIM), vec3(dr, dg, db), dayStrength)
    const fresnel = positionWorld.sub(cameraPosition).normalize().dot(normalWorldGeometry).abs().oneMinus()
    const atmosphereDayStrength = sunOrientation.smoothstep(-0.5, 1)
    const atmosphereMix = atmosphereDayStrength.mul(fresnel.pow(2)).clamp(0, 1)
    lit = mix(lit, atmosphereColor, atmosphereMix)
  }

  material.colorNode = lit
  return material
}

function PlanetMaterial({ body, map }: { body: BodyMeta; map: Texture | null }) {
  const materialRef = useRef<MeshBasicNodeMaterial>(null)
  const material = useMemo(() => buildPlanetMaterial(body, map), [body, map])
  useEffect(() => () => material.dispose(), [material])
  useSunDirectionUniform(body.id, materialRef)
  return <primitive object={material} attach="material" ref={materialRef} />
}

export function BodyMaterial({ body }: BodyMaterialProps) {
  if (body.texture) {
    return <TexturedBodyMaterial body={body} texture={body.texture} />
  }
  return <PlanetMaterial body={body} map={null} />
}

function TexturedBodyMaterial({ body, texture: textureUrl }: BodyMaterialProps & { texture: string }) {
  const map = useTexture(textureUrl, configureSurfaceTexture)
  return <PlanetMaterial body={body} map={map} />
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
