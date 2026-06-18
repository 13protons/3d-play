import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AddEquation,
  CustomBlending,
  FrontSide,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Vector3,
} from 'three'
import type { Mesh } from 'three'
import { useTrajectoriesStore } from '../../state/trajectories'
import type { AtmosphereRenderConfig } from '../../state/trajectories'
import { evaluateCurve } from '../../sim/curves'
import type { Vec3 } from '../lighting'
import {
  ATMOSPHERE_SHELL_FRAGMENT_SHADER,
  ATMOSPHERE_SHELL_VERTEX_SHADER,
} from './atmosphereShellShader'

// Sun radiance scale for the shell's inscatter. Tunable by eye against takram's
// in-atmosphere look + the orbital sunrise; the in-shader exposure tone-map bounds it.
const SHELL_SUN_INTENSITY = 8

/**
 * From-space atmosphere for the parent body: a planet-centred shell whose shader
 * ray-marches single scattering (see atmosphereShellShader). The mesh sits at exactly
 * atmosphereRadius (= topRadius) and is FrontSide: the swap only mounts this when the
 * camera is ABOVE topRadius, so the camera is always outside the mesh and the near
 * hemisphere rasterizes (disc + limb = small, cheap coverage). NOT oversized — an
 * oversized mesh would swallow the camera (inside → FrontSide culls → nothing draws).
 * The shader clips to the true atmosphere via ray-sphere; high tessellation keeps the
 * silhouette (and thus the limb edge) smooth. Additive over the mostly-dark night
 * planet + black space gives the blue limb + red terminator ring. Positioned at the
 * body's floating-origin scene position; sun direction from the emissive body.
 */
export function AtmosphereShell({
  bodyId,
  vehicleId,
  config,
  radius,
}: {
  bodyId: string
  vehicleId: string
  config: AtmosphereRenderConfig
  radius: number
}) {
  const meshRef = useRef<Mesh>(null)

  const uniforms = useMemo(
    () => ({
      uPlanetCenter: { value: new Vector3() },
      uSunDirection: { value: new Vector3(0, 1, 0) },
      uPlanetRadius: { value: radius },
      uAtmosphereRadius: { value: radius + config.shellHeight },
      // takram-native coefficients are per-km; the march is in metres -> ×1e-3.
      uBetaRayleigh: { value: new Vector3(...config.rayleighScattering).multiplyScalar(1e-3) },
      uBetaMie: { value: config.mieScattering * 1e-3 },
      uRayleighScaleHeight: { value: config.rayleighScaleHeight },
      uMieScaleHeight: { value: config.mieScaleHeight },
      uMieG: { value: config.miePhaseFunctionG },
      uSunIntensity: { value: SHELL_SUN_INTENSITY },
    }),
    [config, radius],
  )

  // At exactly atmosphereRadius (= topRadius). The swap guarantees the camera is
  // above topRadius when this mounts, so it's outside the mesh — FrontSide renders.
  const shellMeshRadius = radius + config.shellHeight

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const store = useTrajectoriesStore.getState()
    const { curves, bodies } = store
    const t = store.getSimTime()
    const bodyCurve = curves[bodyId]
    const vehicleCurve = curves[vehicleId]
    if (!bodyCurve || !vehicleCurve) return

    const bodyPos = evaluateCurve(bodyCurve, t) as Vec3
    const vehiclePos = evaluateCurve(vehicleCurve, t) as Vec3
    // Planet centre in scene space (floating origin on the vehicle).
    const cx = bodyPos[0] - vehiclePos[0]
    const cy = bodyPos[1] - vehiclePos[1]
    const cz = bodyPos[2] - vehiclePos[2]
    uniforms.uPlanetCenter.value.set(cx, cy, cz)
    mesh.position.set(cx, cy, cz)

    const sun = Object.values(bodies).find((body) => body.emissive)
    const sunCurve = sun ? curves[sun.id] : undefined
    if (sun && sunCurve) {
      const sunPos = evaluateCurve(sunCurve, t) as Vec3
      uniforms.uSunDirection.value
        .set(sunPos[0] - bodyPos[0], sunPos[1] - bodyPos[1], sunPos[2] - bodyPos[2])
        .normalize()
    }
  })

  return (
    <mesh ref={meshRef} frustumCulled={false}>
      <sphereGeometry args={[shellMeshRadius, 256, 128]} />
      <shaderMaterial
        vertexShader={ATMOSPHERE_SHELL_VERTEX_SHADER}
        fragmentShader={ATMOSPHERE_SHELL_FRAGMENT_SHADER}
        uniforms={uniforms}
        defines={{ VIEW_SAMPLES: '16', LIGHT_SAMPLES: '8' }}
        transparent
        blending={CustomBlending}
        blendEquation={AddEquation}
        blendSrc={OneFactor}
        blendDst={OneMinusSrcAlphaFactor}
        depthWrite={false}
        side={FrontSide}
      />
    </mesh>
  )
}
