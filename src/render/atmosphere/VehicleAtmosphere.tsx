import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { PrecomputedTextures } from '@takram/three-atmosphere'
import { Atmosphere, AtmosphereContext } from '@takram/three-atmosphere/r3f'
import { Ellipsoid } from '@takram/three-geospatial'
import { useTrajectoriesStore } from '../../state/trajectories'
import { evaluateCurve } from '../../sim/curves'
import type { Vec3 } from '../lighting'
import { atmosphereParametersFromRenderConfig } from './atmosphereParameters'
import { getAtmosphereTextures } from './atmosphereTextures'

/** Bake (or fetch from cache) the body's precomputed LUTs once params are known. */
function useAtmosphereTextures(
  bodyId: string,
  params: ReturnType<typeof atmosphereParametersFromRenderConfig> | null,
): PrecomputedTextures | null {
  const gl = useThree((s) => s.gl)
  const [textures, setTextures] = useState<PrecomputedTextures | null>(null)
  useEffect(() => {
    // No params → body has no atmosphere; the caller early-returns and never reads
    // `textures`, so leave it as-is (avoids a synchronous setState in the effect).
    if (!params) return
    let cancelled = false
    getAtmosphereTextures(gl, bodyId, params)
      .then((result) => {
        if (!cancelled) setTextures(result)
      })
      .catch((error) => console.error('[atmosphere] LUT bake failed for', bodyId, error))
    return () => {
      cancelled = true
    }
  }, [gl, bodyId, params])
  return textures
}

const vehicleRelToBody = new Vector3()
const sunDirection = new Vector3()

/**
 * Drive the Atmosphere context's transient state from the sim each frame. The
 * scene uses a floating origin centred on the vehicle, so a scene point P maps to
 * the body-centred ECEF frame as `P + (vehiclePos - bodyPos)` — i.e. the scene
 * origin lands at the vehicle's position relative to the planet centre (~the
 * surface). Rotation is identity: the atmosphere is spherically symmetric, so the
 * planet's spin orientation doesn't affect scattering. `correctAltitude` on the
 * provider recovers the precision the large translation would otherwise lose.
 */
function AtmosphereTransientDriver({
  bodyId,
  vehicleId,
}: {
  bodyId: string
  vehicleId: string
}) {
  const context = useContext(AtmosphereContext)
  useFrame(() => {
    const states = context.transientStates
    if (!states) return
    const store = useTrajectoriesStore.getState()
    const { curves, bodies } = store
    const t = store.getSimTime()
    const bodyCurve = curves[bodyId]
    const vehicleCurve = curves[vehicleId]
    if (!bodyCurve || !vehicleCurve) return

    const bodyPos = evaluateCurve(bodyCurve, t) as Vec3
    const vehiclePos = evaluateCurve(vehicleCurve, t) as Vec3
    vehicleRelToBody.set(
      vehiclePos[0] - bodyPos[0],
      vehiclePos[1] - bodyPos[1],
      vehiclePos[2] - bodyPos[2],
    )
    states.worldToECEFMatrix.makeTranslation(
      vehicleRelToBody.x,
      vehicleRelToBody.y,
      vehicleRelToBody.z,
    )

    // Sun direction in ECEF (== scene axes under identity rotation): planet -> sun.
    const sun = Object.values(bodies).find((body) => body.emissive)
    const sunCurve = sun ? curves[sun.id] : undefined
    if (sun && sunCurve) {
      const sunPos = evaluateCurve(sunCurve, t) as Vec3
      sunDirection
        .set(sunPos[0] - bodyPos[0], sunPos[1] - bodyPos[1], sunPos[2] - bodyPos[2])
        .normalize()
      states.sunDirection.copy(sunDirection)
    }
  })
  return null
}

/**
 * Mounts takram's `<Atmosphere>` provider around `children` for the body the
 * vehicle is at, wiring per-body LUTs + floating-origin placement. When the body
 * has no atmosphere it renders `children` unchanged. takram's visual components
 * (Sky / AerialPerspective / SunLight / SkyLight) are descendants added in later
 * phases; they read this provider's context.
 */
export function VehicleAtmosphere({
  bodyId,
  vehicleId,
  children,
}: {
  bodyId: string
  vehicleId: string
  children: ReactNode
}) {
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const config = body?.atmosphereRender
  const radius = body?.radius
  const params = useMemo(
    () => (config && radius != null ? atmosphereParametersFromRenderConfig(config, radius) : null),
    [config, radius],
  )
  const ellipsoid = useMemo(
    () => (radius != null ? new Ellipsoid(radius, radius, radius) : null),
    [radius],
  )
  const textures = useAtmosphereTextures(bodyId, params)

  if (!params || !ellipsoid) return <>{children}</>

  return (
    <Atmosphere textures={textures ?? undefined} ellipsoid={ellipsoid} correctAltitude>
      <AtmosphereTransientDriver bodyId={bodyId} vehicleId={vehicleId} />
      {children}
    </Atmosphere>
  )
}
