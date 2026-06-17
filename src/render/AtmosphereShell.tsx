import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BackSide,
  Color,
  ShaderMaterial,
  Vector3,
  type Mesh,
} from 'three'
import { useModeStore } from '../state/mode'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import { RENDER_LAYERS } from './renderLayers'
import {
  ATMOSPHERE_FRAGMENT_SHADER,
  ATMOSPHERE_VERTEX_SHADER,
} from './atmosphereScatter'
import type { Vec3 } from './lighting'

/**
 * Planet-centered single-scattering atmosphere. Renders a shell at
 * `radius + shellHeight` with front faces culled, on its own layer/pass so it
 * scatters additively over the surface + stars. Driven entirely by the body's
 * fetched `atmosphereRender` asset — mounted only when that asset is present.
 */
export function AtmosphereShell({
  bodyId,
  vehicleId,
}: {
  bodyId: string
  vehicleId: string
}) {
  const meshRef = useRef<Mesh>(null)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const atmosphere = body?.atmosphereRender
  const radius = body?.radius

  const material = useMemo(() => {
    if (!atmosphere || radius == null) return null
    const [r, g, b] = atmosphere.rayleigh.coefficients
    return new ShaderMaterial({
      vertexShader: ATMOSPHERE_VERTEX_SHADER,
      fragmentShader: ATMOSPHERE_FRAGMENT_SHADER,
      defines: {
        VIEW_SAMPLES: String(Math.max(1, Math.round(atmosphere.viewSamples))),
        LIGHT_SAMPLES: String(Math.max(1, Math.round(atmosphere.lightSamples))),
      },
      uniforms: {
        uPlanetCenter: { value: new Vector3() },
        uSunDirection: { value: new Vector3(1, 0, 0) },
        uPlanetRadius: { value: radius },
        uAtmosphereRadius: { value: radius + atmosphere.shellHeight },
        uBetaRayleigh: { value: new Color(r, g, b) },
        uBetaMie: { value: atmosphere.mie.coefficient },
        uRayleighScaleHeight: { value: atmosphere.rayleigh.scaleHeight },
        uMieScaleHeight: { value: atmosphere.mie.scaleHeight },
        uMieG: { value: atmosphere.mie.anisotropy },
        uSunIntensity: { value: atmosphere.sunIntensity },
      },
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: BackSide,
    })
  }, [atmosphere, radius])

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return
    const mesh = meshRef.current
    if (!mesh || !material) return
    mesh.layers.set(RENDER_LAYERS.atmosphere)

    const store = useTrajectoriesStore.getState()
    const { curves, bodies } = store
    const t = store.getSimTime()
    const bodyCurve = curves[bodyId]
    const vehicleCurve = curves[vehicleId]
    if (!bodyCurve || !vehicleCurve) return

    const bodyPos = evaluateCurve(bodyCurve, t) as Vec3
    const vehiclePos = evaluateCurve(vehicleCurve, t) as Vec3
    // Floating origin: planet center relative to the followed vehicle (~origin).
    const scenePosition: Vec3 = [
      bodyPos[0] - vehiclePos[0],
      bodyPos[1] - vehiclePos[1],
      bodyPos[2] - vehiclePos[2],
    ]
    mesh.position.set(...scenePosition)
    ;(material.uniforms.uPlanetCenter.value as Vector3).set(...scenePosition)

    const sun = Object.values(bodies).find((candidate) => candidate.emissive)
    const sunCurve = sun ? curves[sun.id] : undefined
    if (sunCurve) {
      const sunPos = evaluateCurve(sunCurve, t) as Vec3
      ;(material.uniforms.uSunDirection.value as Vector3)
        .set(sunPos[0] - bodyPos[0], sunPos[1] - bodyPos[1], sunPos[2] - bodyPos[2])
        .normalize()
    }
  })

  if (!material || radius == null || atmosphere == null) return null

  return (
    <mesh ref={meshRef} material={material} frustumCulled={false}>
      <sphereGeometry args={[radius + atmosphere.shellHeight, 64, 64]} />
    </mesh>
  )
}
