import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BackSide, Mesh, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { cameraPosition, color, float, mix, positionWorld, uniform } from 'three/tsl'
import { useModeStore } from '../../state/mode'
import { useTrajectoriesStore } from '../../state/trajectories'
import type { AtmosphereSkyColors, BodyMeta } from '../../state/trajectories'
import { evaluateCurve } from '../../sim/curves'
import { MagnitudeStars } from './MagnitudeStars'
import {
  NAKED_EYE_LIMIT,
  SUN_ANGULAR_RADIUS,
  computeSunHorizon,
  createTwilightColumnSampler,
  limitingMagnitude,
} from './sunHorizon'

/**
 * The from-the-ground sky for the vehicle view — the cheap, analytic stand-in for full
 * scattering proven out in the Dawn spike (src/spike/DawnSpike.tsx), now driven by the
 * real ephemeris instead of sliders. Three pieces:
 *
 *  - a camera-locked TSL dome whose colour is a function of view·sun and view·up, tinted
 *    per planet from the body's `atmosphere.json` `sky` palette (Earth blue/red, Mars
 *    butterscotch/blue, Venus ochre);
 *  - a magnitude-graded starfield that fades in as the limiting magnitude rises through
 *    twilight (and is always full on airless bodies, where there's no sky to wash it out);
 *  - the throttled, far-field-skipped twilight-column sampler that feeds both.
 *
 * Everything is one `useFrame` of scalar geometry (see ./sunHorizon) writing a handful of
 * uniforms — no LUTs, no marching shader. The dome and stars render as additive background
 * (drawn first, no depth write) so the opaque planet/terrain paint over them, occluding the
 * sky below the horizon for free.
 */

const DEG = Math.PI / 180
const STAR_SHELL_RADIUS = 5e8 // matches the vehicle view's previous star shell
const SKY_DOME_RADIUS = 1e7 // camera-locked; just needs to sit inside the far plane (1e9)

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

interface DomeUniforms {
  sunU: { value: Vector3 }
  upU: { value: Vector3 }
  illumU: { value: number }
  glowU: { value: number }
  rednessU: { value: number }
  darkenU: { value: number }
  horizonU: { value: number }
}

/** Build the analytic sky-dome material for one planet's palette. Mirrors the Dawn spike's
 *  SkyDome graph; see there for the derivation of each term. */
function buildDomeMaterial(sky: AtmosphereSkyColors): MeshBasicNodeMaterial {
  const sunU = uniform(new Vector3())
  const upU = uniform(new Vector3())
  const illumU = uniform(0)
  const glowU = uniform(0)
  const rednessU = uniform(0)
  const darkenU = uniform(0)
  const horizonU = uniform(0) // view·up of the true horizon (= -sin(dip)), negative

  const view = positionWorld.sub(cameraPosition).normalize()
  const sunCos = view.dot(sunU)
  const upCos = view.dot(upU)
  // Full-bright to the geometric horizon, then cut off just under it (the opaque planet
  // occludes everything lower, so no black gap appears between the sky and the limb).
  const aboveHorizon = upCos.smoothstep(horizonU.sub(0.08), horizonU)

  const towardSun = sunCos.mul(0.5).add(0.5) // 1 at the sun, 0 directly opposite
  const horizonProx = upCos.smoothstep(0.6, horizonU) // 1 at the limb, 0 by ~37° up

  // Base sky: day gradient shifted toward the deep low-sun colour where the air reddens,
  // concentrated low and toward the sun. This shift is the whole sunset (or blue Mars dusk).
  const horizonFactor = upCos.max(0).oneMinus()
  const dayColor = mix(color(sky.zenith), color(sky.horizon), horizonFactor)
  const lowSunMix = rednessU.mul(towardSun).mul(horizonProx).clamp(0, 1)
  const baseColor = mix(dayColor, color(sky.lowSunDeep), lowSunMix)

  // Anti-sun darkening at twilight (the rising shadow side); no effect by day (darkenU ~0).
  const antiSun = mix(float(1), towardSun.clamp(0.1, 1), darkenU)
  const litSky = baseColor.mul(illumU).mul(antiSun)

  // Tight whitening right around the sun, and a broad warm/low-sun glow band on the horizon.
  const aureole = color(sky.sunHalo).mul(sunCos.max(0).pow(8).mul(illumU).mul(0.6))
  const lowSunGlow = color(sky.lowSunGlow).mul(towardSun.pow(3).mul(horizonProx).mul(glowU).mul(1.6))

  const material = new MeshBasicNodeMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  material.colorNode = litSky.add(aureole).add(lowSunGlow).mul(aboveHorizon)
  material.userData = { sunU, upU, illumU, glowU, rednessU, darkenU, horizonU }
  return material
}

/** Resolve the vehicle's parent body reactively (radius + atmosphere palette live here). */
function useVehicleParent(): BodyMeta | undefined {
  return useTrajectoriesStore((s) => {
    const vehicle = Object.values(s.vehicles)[0]
    return vehicle ? s.bodies[vehicle.parentId] : undefined
  })
}

const SCRATCH_SUN = new Vector3()
const SCRATCH_UP = new Vector3()

export function VehicleSky() {
  const domeRef = useRef<Mesh>(null)
  const parent = useVehicleParent()
  const sky = parent?.atmosphereRender?.sky

  const domeMaterial = useMemo(() => (sky ? buildDomeMaterial(sky) : null), [sky])
  useEffect(() => () => domeMaterial?.dispose(), [domeMaterial])

  // Live limiting magnitude for the starfield, written each frame below and read by MagnitudeStars.
  const limitRef = useRef(NAKED_EYE_LIMIT)

  // Stable per-instance sampler: far-field skip + change-driven (time-warp-correct) throttle.
  const samplerRef = useRef(createTwilightColumnSampler())

  useFrame((state) => {
    if (useModeStore.getState().activeView !== 'vehicle') return

    const store = useTrajectoriesStore.getState()
    const vehicle = Object.values(store.vehicles)[0]
    const parentBody = vehicle ? store.bodies[vehicle.parentId] : undefined
    const sun = Object.values(store.bodies).find((b) => b.emissive)
    if (!vehicle || !parentBody || !sun) return

    const { curves } = store
    const vehicleCurve = curves[vehicle.id]
    const parentCurve = curves[parentBody.id]
    const sunCurve = curves[sun.id]
    if (!vehicleCurve || !parentCurve || !sunCurve) return

    const t = store.getSimTime()
    const vp = evaluateCurve(vehicleCurve, t) as [number, number, number]
    const pp = evaluateCurve(parentCurve, t) as [number, number, number]
    const sp = evaluateCurve(sunCurve, t) as [number, number, number]

    // Directions are translation-invariant, so the floating-origin offset drops out.
    SCRATCH_SUN.set(sp[0] - vp[0], sp[1] - vp[1], sp[2] - vp[2]).normalize()
    SCRATCH_UP.set(vp[0] - pp[0], vp[1] - pp[1], vp[2] - pp[2]).normalize()

    const atmo = parentBody.atmosphereRender
    if (!atmo) {
      // Airless body: no dome, full starfield day and night.
      limitRef.current = NAKED_EYE_LIMIT
      return
    }

    const R = parentBody.radius
    const thickness = atmo.shellHeight
    const observer = { x: vp[0], y: vp[1], z: vp[2] }
    const planetCenter = { x: pp[0], y: pp[1], z: pp[2] }

    const horizon = computeSunHorizon(observer, planetCenter, R, SCRATCH_SUN, SUN_ANGULAR_RADIUS)
    const column = samplerRef.current.sample({
      observer,
      planetCenter,
      planetRadius: R,
      atmosphereThickness: thickness,
      sunDirection: SCRATCH_SUN,
      scaleHeight: atmo.rayleigh.scaleHeight,
    })

    limitRef.current = limitingMagnitude(horizon.altitude, column.airAbove)

    const dome = domeRef.current
    if (!dome || !domeMaterial) return
    dome.position.copy(state.camera.position) // skybox: always centred on the camera

    const sunAltDeg = horizon.altitude / DEG
    const glowBand = smoothstep01(-12, 0, sunAltDeg) * (1 - smoothstep01(0, 9, sunAltDeg))
    const glow = glowBand * column.redness * column.airAbove
    const darkening = smoothstep01(15, -3, sunAltDeg) * column.airAbove

    // Horizon dip from the *camera's* altitude (not the vehicle's) so the sky meets the
    // rendered limb: world camera = vehicle + camera offset; its distance to the planet centre.
    const ex = vp[0] - pp[0] + state.camera.position.x
    const ey = vp[1] - pp[1] + state.camera.position.y
    const ez = vp[2] - pp[2] + state.camera.position.z
    const eyeRadius = Math.hypot(ex, ey, ez) || R
    const horizonLevel = -Math.sqrt(Math.max(0, 1 - (R / eyeRadius) ** 2))

    // Mutate via the ref's material (refs are mutable per react-hooks rules); cast through the
    // Mesh's Material|Material[] union to reach the uniforms.
    const u = (dome.material as MeshBasicNodeMaterial).userData as DomeUniforms
    u.sunU.value.copy(SCRATCH_SUN)
    u.upU.value.copy(SCRATCH_UP)
    // Soften the altitude fade: raw airAbove dims the dome too steeply (real high-altitude skies
    // stay bluer than the bare air-mass fraction, from the horizon path + multiple scattering).
    // pow(airAbove, 0.6) keeps sea level unchanged but lifts the mid-altitude sky (8%→20% at 20 km).
    u.illumU.value = Math.pow(column.airAbove, 0.6) * column.intensity
    u.glowU.value = glow
    u.rednessU.value = column.redness
    u.darkenU.value = darkening
    u.horizonU.value = horizonLevel
  })

  return (
    <>
      {domeMaterial && (
        <mesh
          ref={domeRef}
          material={domeMaterial}
          renderOrder={-10}
        >
          <sphereGeometry args={[SKY_DOME_RADIUS, 48, 24]} />
        </mesh>
      )}
      <MagnitudeStars
        radius={STAR_SHELL_RADIUS}
        limitRef={limitRef}
      />
    </>
  )
}
