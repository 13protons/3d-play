import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { AdditiveBlending, BackSide, Mesh, Vector3 } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { cameraPosition, color, float, mix, normalWorldGeometry, positionWorld, uniform, vec3 } from 'three/tsl'
import { makeWebGPURenderer } from '../render/webgpuRenderer'
import { RenderPipeline } from '../render/RenderPipeline'

/**
 * Spike: atmosphere from altitude, in the EXACT conditions the live vehicle view uses — real
 * planet scale, a reversed-Z depth buffer, floating origin (a stand-in "vehicle" pinned at the
 * scene origin, planet centre directly below at −(R+altitude)). Scrub the altitude slider to fly
 * from the ground out past the 100 km atmosphere top and watch the effect across the whole
 * transition; the other sliders tune the limb live (uniforms, no rebuild). This is where we work
 * out an atmosphere that reads right both inside and outside the shell before porting it back.
 *
 * Reproduces both bugs seen in the live view so we can kill them here: the glow drawing over the
 * close vehicle (depthTest), and the banding when the camera is inside the shell.
 */
const R = 6.371e6 // planet radius (m), Earth-like
const SHELL = 1.0e5 // atmosphere shell height (m) — 100 km
const VEHICLE_SIZE = 4 // stand-in vehicle (m), at the scene origin to test occlusion

// Earth-ish sky palette (same idea as atmosphere.json `sky`).
const ZENITH = '#2a62c4'
const HORIZON = '#a9c6ec'
const LOW_SUN = '#ff7a2e' // warm orange — red over blue reads magenta, orange stays sunset-warm

interface Knobs {
  altitudeKm: number
  sunAzimuthDeg: number
  strength: number
  bandFalloff: number
  discFadeBands: number
  fadeStartShell: number // ×SHELL
  fadeEndShell: number // ×SHELL
  depthTest: boolean
}

const DEFAULTS: Knobs = {
  altitudeKm: 140,
  sunAzimuthDeg: 70,
  strength: 1.6,
  bandFalloff: 1.4,
  discFadeBands: 2.0,
  fadeStartShell: 0.0,
  fadeEndShell: 1.2,
  depthTest: true,
}

interface AtmoUniforms {
  planetCenter: { value: Vector3 }
  sunDir: { value: Vector3 }
  fade: { value: number }
  strength: { value: number }
  bandFalloff: { value: number }
  discFadeBands: { value: number }
}

function buildAtmosphere(depthTest: boolean): { material: MeshBasicNodeMaterial; uniforms: AtmoUniforms } {
  const planetCenter = uniform(new Vector3(0, -(R + SHELL), 0))
  const sunDir = uniform(new Vector3(1, 0, 0))
  const fade = uniform(0)
  const strength = uniform(DEFAULTS.strength)
  const bandFalloff = uniform(DEFAULTS.bandFalloff)
  const discFadeBands = uniform(DEFAULTS.discFadeBands)

  // View ray's closest-approach distance to the planet centre — the one scalar the look is built
  // from (analytic occlusion; no depthTest reliance for the planet).
  const viewDir = positionWorld.sub(cameraPosition).normalize()
  const ro = cameraPosition.sub(planetCenter)
  const tca = ro.dot(viewDir).negate() // signed distance along the ray to the closest approach
  const closest = ro.add(viewDir.mul(tca))
  const dMin = closest.length()

  const band = float(R + SHELL).sub(dMin).div(SHELL).clamp(0, 1).pow(bandFalloff)
  const overDisc = dMin.smoothstep(float(R).sub(discFadeBands.mul(SHELL)), float(R))
  // Forward gate: only glow where the ray heads TOWARD the planet (tca > 0). When the closest
  // approach is behind the camera (tca < 0, looking up/out) the closest-approach distance is
  // meaningless and lights a spurious second band high in the sky — this removes it.
  const forward = tca.smoothstep(0, SHELL * 2)
  const limbDir = closest.normalize()
  const dayGate = limbDir.dot(sunDir).smoothstep(-0.35, 0.35)
  const intensity = band.mul(overDisc).mul(forward).mul(dayGate).mul(strength).mul(fade)

  const baseColor = mix(color(HORIZON), color(ZENITH), band)
  // Warm tint only at the true terminator: peak at dayGate≈0.5, narrowed (pow) so the day side
  // stays blue, and kept gentle so it reads as a warm edge rather than a magenta wash.
  const terminator = dayGate.mul(dayGate.oneMinus()).mul(4).clamp(0, 1).pow(2.2).mul(0.5)
  const limbColor = mix(baseColor, color(LOW_SUN), terminator)

  const material = new MeshBasicNodeMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    depthTest,
    blending: AdditiveBlending,
  })
  material.colorNode = limbColor.mul(intensity)
  material.userData = { planetCenter, sunDir, fade, strength, bandFalloff, discFadeBands }
  return { material, uniforms: material.userData as AtmoUniforms }
}

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function Planet({ knobs }: { knobs: Knobs }) {
  const planetRef = useRef<Mesh>(null)
  const atmoRef = useRef<Mesh>(null)

  // Planet surface material: a simple day/night terminator, shared sun direction.
  const planetMaterial = useMemo(() => {
    const sunDir = uniform(new Vector3(1, 0, 0))
    const m = new MeshBasicNodeMaterial()
    // Don't write depth: then the atmosphere's depthTest occludes only against the vehicle (which
    // does write depth), so the glow bleeds over the ground but the vehicle still punches through.
    m.depthWrite = false
    const dayStrength = normalWorldGeometry.dot(sunDir).smoothstep(-0.25, 0.5)
    m.colorNode = mix(vec3(0.015, 0.03, 0.06), vec3(0.18, 0.4, 0.22), dayStrength)
    m.userData = { sunDir }
    return m
  }, [])
  useEffect(() => () => planetMaterial.dispose(), [planetMaterial])

  // Rebuild the atmosphere material when depthTest toggles (it's a construction-time flag).
  const atmo = useMemo(() => buildAtmosphere(knobs.depthTest), [knobs.depthTest])
  useEffect(() => () => atmo.material.dispose(), [atmo])

  useFrame(() => {
    const planet = planetRef.current
    const atmoMesh = atmoRef.current
    if (!planet || !atmoMesh) return

    const altitude = knobs.altitudeKm * 1000
    const az = (knobs.sunAzimuthDeg * Math.PI) / 180
    const sun = new Vector3(Math.cos(az), 0.25, Math.sin(az)).normalize()

    // Floating origin: vehicle at the scene origin, planet centre directly below.
    const center = new Vector3(0, -(R + altitude), 0)
    planet.position.copy(center)
    atmoMesh.position.copy(center)

    // Mutate uniforms via the refs' materials (refs are mutable; the memoized materials aren't).
    ;((planet.material as MeshBasicNodeMaterial).userData.sunDir as { value: Vector3 }).value.copy(sun)
    const u = (atmoMesh.material as MeshBasicNodeMaterial).userData as AtmoUniforms
    u.planetCenter.value.copy(center)
    u.sunDir.value.copy(sun)
    u.strength.value = knobs.strength
    u.bandFalloff.value = knobs.bandFalloff
    u.discFadeBands.value = knobs.discFadeBands
    u.fade.value = smoothstep01(knobs.fadeStartShell * SHELL, knobs.fadeEndShell * SHELL, altitude)
  })

  return (
    <>
      <mesh ref={planetRef} material={planetMaterial}>
        <sphereGeometry args={[R, 128, 64]} />
      </mesh>
      <mesh ref={atmoRef} material={atmo.material} frustumCulled={false} renderOrder={-8}>
        <sphereGeometry args={[R + SHELL, 96, 48]} />
      </mesh>
    </>
  )
}

function VehicleStandIn() {
  // A small opaque box at the scene origin — to verify the glow doesn't draw over the vehicle.
  return (
    <mesh>
      <boxGeometry args={[VEHICLE_SIZE, VEHICLE_SIZE, VEHICLE_SIZE * 2]} />
      <meshBasicMaterial color='#c8c8d0' />
    </mesh>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <label style={{ display: 'block', marginTop: 8 }}>
      {label} <span style={{ opacity: 0.7 }}>{value}</span>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 260, display: 'block' }}
      />
    </label>
  )
}

export function AtmosphereSpikePage() {
  const [knobs, setKnobs] = useState<Knobs>(DEFAULTS)
  const set = (patch: Partial<Knobs>) => setKnobs((k) => ({ ...k, ...patch }))

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
      <Canvas
        camera={{ position: [0, 30, 120], near: 0.1, far: 1e9, fov: 50 }}
        gl={makeWebGPURenderer({ reversedDepthBuffer: true })}
      >
        <RenderPipeline withBloom />
        <Planet knobs={knobs} />
        <VehicleStandIn />
        <OrbitControls
          minDistance={VEHICLE_SIZE}
          maxDistance={5000}
          target={[0, 0, 0]}
        />
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
          maxWidth: 300,
        }}
      >
        <div>Atmosphere spike — real scale, reversed-Z, floating origin. Orbit the white box (the
          "vehicle"); scrub altitude to fly ground → orbit.</div>
        <Slider label='altitude (km)' value={knobs.altitudeKm} min={0} max={300} step={1} onChange={(v) => set({ altitudeKm: v })} />
        <Slider label='sun azimuth (°)' value={knobs.sunAzimuthDeg} min={0} max={360} step={1} onChange={(v) => set({ sunAzimuthDeg: v })} />
        <Slider label='strength' value={knobs.strength} min={0} max={5} step={0.05} onChange={(v) => set({ strength: v })} />
        <Slider label='band falloff' value={knobs.bandFalloff} min={0.5} max={4} step={0.05} onChange={(v) => set({ bandFalloff: v })} />
        <Slider label='disc fade (shells)' value={knobs.discFadeBands} min={0.2} max={6} step={0.1} onChange={(v) => set({ discFadeBands: v })} />
        <Slider label='fade start (×shell)' value={knobs.fadeStartShell} min={0} max={2} step={0.05} onChange={(v) => set({ fadeStartShell: v })} />
        <Slider label='fade end (×shell)' value={knobs.fadeEndShell} min={0} max={3} step={0.05} onChange={(v) => set({ fadeEndShell: v })} />
        <label style={{ display: 'block', marginTop: 8 }}>
          <input type='checkbox' checked={knobs.depthTest} onChange={(e) => set({ depthTest: e.target.checked })} /> depthTest (vehicle occludes glow)
        </label>
        <div style={{ marginTop: 10, opacity: 0.7 }}>
          Atmosphere top is at {SHELL / 1000} km. Watch the inside→outside transition and whether
          the glow ever covers the box.
        </div>
      </div>
    </div>
  )
}
