import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BackSide, Mesh, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { cameraPosition, color, float, mix, positionWorld, uniform } from 'three/tsl'
import { useModeStore } from '../../state/mode'
import { useTrajectoriesStore } from '../../state/trajectories'
import type { AtmosphereSkyColors, BodyMeta } from '../../state/trajectories'
import { evaluateCurve } from '../../sim/curves'

/**
 * Stylized atmosphere limb glow for the vehicle view — a cheap, good-enough stand-in for single
 * scattering (no light loops, no optical-depth integral), validated in src/spike/AtmosphereSpike.
 *
 * A planet-centred additive backside shell whose brightness comes from one scalar: the view ray's
 * closest-approach distance to the planet centre.
 *   d_min ≈ R        → grazing the surface, thickest air → brightest
 *   d_min → R+shellH  → skimming the atmosphere top      → fades to 0
 *   d_min ≪ R         → into the disc                    → fades out (no full-planet wash)
 * A forward gate (the closest approach must be in FRONT of the camera) suppresses the spurious
 * second band the closest-approach metric otherwise lights high in the sky. Occlusion of the disc
 * is analytic (that scalar), so it's reversed-Z-safe where a depthTest-occluded shell isn't.
 *
 * depthTest ON: the terrain occludes the glow over the ground (so this reads as a limb halo around
 * the planet's edge) and the close vehicle occludes it too. Sun-gated (bright on the lit limb,
 * warming toward the terminator) and coloured from the body's per-planet `sky` palette. Fades in
 * with altitude (off on the ground, where the VehicleSky dome owns the sky) — see FADE_*.
 */
const STRENGTH = 1.6
const BAND_FALLOFF = 1.4 // >1 concentrates the glow toward the surface line
const DISC_FADE_BANDS = 2.0 // how far (in shell-heights) below the limb the glow fades into the disc
const TERMINATOR_MIX = 0.5 // peak warm-tint fraction at the terminator
const TERMINATOR_NARROW = 2.2 // >1 narrows the warm tint to the true terminator (keeps the day side blue)
const FADE_END_SHELLS = 1.2 // altitude (×shellHeight) at which the limb reaches full strength (0 on the ground)

interface LimbUniforms {
  planetCenter: { value: Vector3 }
  sunDir: { value: Vector3 }
  fade: { value: number }
}

function buildAtmosphereLimbMaterial(body: BodyMeta, sky: AtmosphereSkyColors): MeshBasicNodeMaterial {
  const atmo = body.atmosphereRender!
  const R = body.radius
  const atmR = R + atmo.shellHeight
  const shell = atmo.shellHeight

  const planetCenter = uniform(new Vector3())
  const sunDir = uniform(new Vector3(1, 0, 0))
  const fade = uniform(0)

  const viewDir = positionWorld.sub(cameraPosition).normalize()
  const ro = cameraPosition.sub(planetCenter)
  const tca = ro.dot(viewDir).negate() // signed distance along the ray to the closest approach
  const closest = ro.add(viewDir.mul(tca))
  const dMin = closest.length()

  const band = float(atmR).sub(dMin).div(shell).clamp(0, 1).pow(BAND_FALLOFF)
  const overDisc = dMin.smoothstep(float(R).sub(shell * DISC_FADE_BANDS), float(R))
  // Forward gate: only glow where the ray heads toward the planet (tca > 0); otherwise the
  // closest-approach distance is meaningless and lights a spurious second band high in the sky.
  const forward = tca.smoothstep(0, shell * 2)
  const limbDir = closest.normalize()
  const dayGate = limbDir.dot(sunDir).smoothstep(-0.35, 0.35)
  const intensity = band.mul(overDisc).mul(forward).mul(dayGate).mul(STRENGTH).mul(fade)

  const baseColor = mix(color(sky.horizon), color(sky.zenith), band)
  // Warm tint only at the true terminator (peak at dayGate≈0.5, narrowed so the day side stays
  // the sky colour). Uses the per-planet warm low-sun colour — red over blue reads magenta.
  const terminator = dayGate.mul(dayGate.oneMinus()).mul(4).clamp(0, 1).pow(TERMINATOR_NARROW).mul(TERMINATOR_MIX)
  const limbColor = mix(baseColor, color(sky.lowSunGlow), terminator)

  const material = new MeshBasicNodeMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
  })
  material.colorNode = limbColor.mul(intensity)
  material.userData = { planetCenter, sunDir, fade }
  return material
}

export function AtmosphereLimb({ bodyId, vehicleId }: { bodyId: string; vehicleId: string }) {
  const meshRef = useRef<Mesh>(null)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const sky = body?.atmosphereRender?.sky

  const material = useMemo(
    () => (body?.atmosphereRender && sky ? buildAtmosphereLimbMaterial(body, sky) : null),
    [body, sky],
  )
  useEffect(() => () => material?.dispose(), [material])

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return
    const mesh = meshRef.current
    if (!mesh || !material || !body?.atmosphereRender) return

    const store = useTrajectoriesStore.getState()
    const { curves, bodies } = store
    const t = store.getSimTime()
    const bodyCurve = curves[bodyId]
    const vehicleCurve = curves[vehicleId]
    if (!bodyCurve || !vehicleCurve) return
    const bodyPos = evaluateCurve(bodyCurve, t) as [number, number, number]
    const vehiclePos = evaluateCurve(vehicleCurve, t) as [number, number, number]
    // Floating origin: planet centre relative to the followed vehicle (~scene origin).
    const sx = bodyPos[0] - vehiclePos[0]
    const sy = bodyPos[1] - vehiclePos[1]
    const sz = bodyPos[2] - vehiclePos[2]
    mesh.position.set(sx, sy, sz)

    // Mutate uniforms via the ref's material (refs are mutable; the memoized material isn't).
    const u = (mesh.material as MeshBasicNodeMaterial).userData as LimbUniforms
    u.planetCenter.value.set(sx, sy, sz)
    const sun = bodies && Object.values(bodies).find((b) => b.emissive)
    const sunCurve = sun ? curves[sun.id] : undefined
    if (sunCurve) {
      const sp = evaluateCurve(sunCurve, t) as [number, number, number]
      u.sunDir.value.set(sp[0] - bodyPos[0], sp[1] - bodyPos[1], sp[2] - bodyPos[2]).normalize()
    }
    // Fade in with altitude: off on the ground (VehicleSky dome owns the sky), full by FADE_END.
    const altitude = Math.hypot(sx, sy, sz) - body.radius
    const fadeEnd = body.atmosphereRender.shellHeight * FADE_END_SHELLS
    u.fade.value = Math.max(0, Math.min(1, altitude / fadeEnd))
  })

  if (!body?.atmosphereRender || !sky || !material) return null

  return (
    <mesh
      ref={meshRef}
      material={material}
      frustumCulled={false}
      renderOrder={-8}
    >
      <sphereGeometry args={[body.radius + body.atmosphereRender.shellHeight, 96, 48]} />
    </mesh>
  )
}
