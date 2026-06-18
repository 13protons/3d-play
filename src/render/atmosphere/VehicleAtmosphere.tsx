import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { EffectComposer } from '@react-three/postprocessing'
import { Vector3 } from 'three'
import type { PrecomputedTextures } from '@takram/three-atmosphere'
import { AerialPerspective, Atmosphere, AtmosphereContext, Sky } from '@takram/three-atmosphere/r3f'
import { Ellipsoid } from '@takram/three-geospatial'
import { useTrajectoriesStore } from '../../state/trajectories'
import { evaluateCurve } from '../../sim/curves'
import type { Vec3 } from '../lighting'
import { atmosphereParametersFromRenderConfig } from './atmosphereParameters'
import { getAtmosphereTextures } from './atmosphereTextures'
import { AtmosphereShell } from './AtmosphereShell'

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
 * Reports whether the camera has climbed above the atmosphere shell (topRadius).
 * Aerial perspective is "look through the air" — only valid from inside the
 * atmosphere — so above the shell we switch it off and let the Sky mesh carry the
 * from-space look (limb + black space). Hysteresis (2%/-2%) keeps orbiting near the
 * edge from thrashing the effect pass. Camera ECEF position: the scene origin is the
 * vehicle, so cameraECEF = cameraScenePos + (vehiclePos - bodyPos).
 */
function CameraAtmosphereGate({
  bodyId,
  vehicleId,
  topRadius,
  onAboveChange,
}: {
  bodyId: string
  vehicleId: string
  topRadius: number
  onAboveChange: (above: boolean) => void
}) {
  const camera = useThree((s) => s.camera)
  const aboveRef = useRef<boolean | null>(null)
  useFrame(() => {
    const store = useTrajectoriesStore.getState()
    const { curves } = store
    const t = store.getSimTime()
    const bodyCurve = curves[bodyId]
    const vehicleCurve = curves[vehicleId]
    if (!bodyCurve || !vehicleCurve) return
    const bodyPos = evaluateCurve(bodyCurve, t) as Vec3
    const vehiclePos = evaluateCurve(vehicleCurve, t) as Vec3
    const ex = camera.position.x + (vehiclePos[0] - bodyPos[0])
    const ey = camera.position.y + (vehiclePos[1] - bodyPos[1])
    const ez = camera.position.z + (vehiclePos[2] - bodyPos[2])
    const cameraRadius = Math.hypot(ex, ey, ez)
    const above =
      aboveRef.current == null
        ? cameraRadius > topRadius
        : aboveRef.current
          ? cameraRadius > topRadius * 0.98
          : cameraRadius > topRadius * 1.02
    if (above !== aboveRef.current) {
      aboveRef.current = above
      onAboveChange(above)
    }
  })
  return null
}

/**
 * Owns the vehicle scene's EffectComposer and, for a body with an atmosphere,
 * mounts takram's `<Atmosphere>` provider with per-body LUTs + floating-origin
 * placement. The sky/atmosphere visual is the `<Sky>` MESH (SkyMaterial), which is
 * what correctly transitions from "sky from within" to "atmosphere from space" —
 * `AerialPerspective` is left with its default `sky:false` and only fogs geometry
 * (this is takram's canonical pattern; `sky:true` on the effect fills the
 * background with inscatter and doesn't recede to space). Airless bodies get a bare
 * composer. Our own lights + celestial bodies are unchanged (decision A / D2):
 * takram's sun/moon disks stay off — we render the sim's bodies, eclipse-aware —
 * and our directional sun + ambient light the scene, so takram's lights stay off.
 */
export function VehicleAtmosphere({
  bodyId,
  vehicleId,
}: {
  bodyId: string
  vehicleId: string
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
  // Camera above the atmosphere shell → switch off aerial perspective (see gate).
  const [cameraAbove, setCameraAbove] = useState(false)

  // Airless body: composer renders the scene with no atmosphere effect.
  if (!params || !ellipsoid) {
    return (
      <EffectComposer>
        <></>
      </EffectComposer>
    )
  }

  return (
    <Atmosphere textures={textures ?? undefined} ellipsoid={ellipsoid} correctAltitude>
      <AtmosphereTransientDriver bodyId={bodyId} vehicleId={vehicleId} />
      <CameraAtmosphereGate
        bodyId={bodyId}
        vehicleId={vehicleId}
        topRadius={params.topRadius}
        onAboveChange={setCameraAbove}
      />
      {/* Hard swap (crossfade TODO): below the shell, takram's in-atmosphere look
          (Sky + aerial perspective); above the shell, the from-space limb shell. */}
      {textures && !cameraAbove && <Sky sun={false} moon={false} />}
      {cameraAbove && config && radius != null && (
        <AtmosphereShell
          bodyId={bodyId}
          vehicleId={vehicleId}
          config={config}
          radius={radius}
        />
      )}
      <EffectComposer>
        {textures && !cameraAbove ? (
          <AerialPerspective sun={false} moon={false} />
        ) : (
          <></>
        )}
      </EffectComposer>
    </Atmosphere>
  )
}
