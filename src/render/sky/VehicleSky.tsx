import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type { PointsMaterial } from 'three'
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js'
import { uniform } from 'three/tsl'
import { useModeStore } from '../../state/mode'
import { useTrajectoriesStore } from '../../state/trajectories'
import { evaluateCurve } from '../../sim/curves'
import { createStarfieldGeometry } from './starfieldGeometry'

/**
 * The vehicle view's sky: three's Preetham `SkyMesh` (TSL/WebGPU) as a background
 * dome, cross-faded with a starfield. Driven each frame from real sim state:
 *
 *  - atmosphere: the *camera's* altitude above the parent body vs its atmosphere
 *    shell (0 in space → 1 near the surface), so zooming out thins the sky to space.
 *  - dayness: the sun's elevation above the local horizon (0 below it), so the sky
 *    darkens to night — Preetham never does this on its own.
 *
 * Sky strength = atmosphere × dayness multiplies the Preetham colour; the stars fade
 * in as it drops, so daytime washes them out while night *and* space show stars.
 *
 * Rendered as an opaque, depth-test-OFF, low-renderOrder, camera-attached dome:
 * depth testing off means SkyMesh's far-plane `z = w` trick is ignored, so the
 * vehicle canvas's reversed-Z depth buffer doesn't misplace it, and as an opaque
 * background it draws first — terrain/vehicle paint over it, the depth-tested star
 * shell sits behind them. `upUniform`/`sunPosition` orient the gradient + sun to the
 * planet's local up.
 *
 * Everything is read imperatively in the frame loop so the ~100 Hz sim state never
 * re-renders the scene tree.
 */
const planetCenter = new Vector3()
const cameraRelative = new Vector3()
const localUp = new Vector3()
const sunDirection = new Vector3()

// Dayness ramp over sin(sun elevation): full night once the sun is well below the
// horizon, full day just above it. Biased below the horizon so dawn/dusk keep the sky
// washed out (bright) through twilight rather than snapping to dark at sunset.
const NIGHT_SUN_ELEVATION = -0.3 // sin(elevation) ≈ sun ~17° below horizon → full night
const DAY_SUN_ELEVATION = 0.1 // sin(elevation) ≈ sun ~6° above horizon → full day

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

export function VehicleSky({
  vehicleId,
  radius = 5e8,
  count = 3000,
}: {
  vehicleId: string
  radius?: number
  count?: number
}) {
  const camera = useThree((s) => s.camera)
  const skyRef = useRef<SkyMesh>(null)
  const starsMaterialRef = useRef<PointsMaterial>(null)

  const sky = useMemo(() => {
    const mesh = new SkyMesh()
    mesh.turbidity.value = 8
    mesh.rayleigh.value = 2
    mesh.mieCoefficient.value = 0.005
    mesh.mieDirectionalG.value = 0.8
    const strength = uniform(0)
    mesh.userData.strength = strength
    if (mesh.material.colorNode) {
      mesh.material.colorNode = mesh.material.colorNode.mul(strength)
    }
    mesh.material.depthTest = false
    mesh.material.depthWrite = false
    mesh.renderOrder = -1
    mesh.frustumCulled = false
    mesh.scale.setScalar(1e6)
    return mesh
  }, [])

  const starGeometry = useMemo(() => createStarfieldGeometry(radius, count), [radius, count])
  useEffect(() => () => starGeometry.dispose(), [starGeometry])

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return
    const mesh = skyRef.current
    const starsMaterial = starsMaterialRef.current

    const store = useTrajectoriesStore.getState()
    const vehicle = store.vehicles[vehicleId]
    const parent = vehicle ? store.bodies[vehicle.parentId] : undefined
    const t = store.getSimTime()
    const bodyCurve = parent ? store.curves[parent.id] : undefined
    const vehicleCurve = vehicle ? store.curves[vehicleId] : undefined

    let strength = 0
    if (parent && bodyCurve && vehicleCurve) {
      const bodyPos = evaluateCurve(bodyCurve, t) as [number, number, number]
      const vehiclePos = evaluateCurve(vehicleCurve, t) as [number, number, number]
      // Planet centre in the vehicle-origin scene frame.
      planetCenter.set(bodyPos[0] - vehiclePos[0], bodyPos[1] - vehiclePos[1], bodyPos[2] - vehiclePos[2])
      cameraRelative.copy(camera.position).sub(planetCenter)
      const altitude = cameraRelative.length() - parent.radius
      localUp.copy(cameraRelative).normalize()

      // Atmosphere thins exponentially with altitude (the density/pressure gradient),
      // using the body's Rayleigh scale height — not a linear shell. Airless bodies
      // (no config) get no sky.
      const scaleHeight = parent.atmosphereRender?.rayleigh.scaleHeight ?? 0
      const atmosphere = scaleHeight > 0 ? clamp01(Math.exp(-Math.max(0, altitude) / scaleHeight)) : 0

      // Sun direction (planet → sun) and its elevation above the local horizon.
      const sun = Object.values(store.bodies).find((body) => body.emissive)
      const sunCurve = sun ? store.curves[sun.id] : undefined
      let dayness = 1
      if (sun && sunCurve) {
        const sunPos = evaluateCurve(sunCurve, t) as [number, number, number]
        sunDirection
          .set(sunPos[0] - bodyPos[0], sunPos[1] - bodyPos[1], sunPos[2] - bodyPos[2])
          .normalize()
        dayness = smoothstep(NIGHT_SUN_ELEVATION, DAY_SUN_ELEVATION, sunDirection.dot(localUp))
      }
      strength = atmosphere * dayness

      if (mesh) {
        mesh.position.copy(camera.position) // keep the dome centred on the viewer
        mesh.upUniform.value.copy(localUp)
        mesh.sunPosition.value.copy(sunDirection).multiplyScalar(4e5)
      }
    }

    if (mesh) (mesh.userData.strength as { value: number }).value = strength
    if (starsMaterial) {
      const opacity = clamp01(1 - strength)
      starsMaterial.opacity = opacity
      starsMaterial.visible = opacity > 0.01
    }
  })

  return (
    <>
      {/* Black clear behind the sky + stars (RenderPipeline's scene pass clears to it). */}
      <color attach="background" args={[0, 0, 0]} />
      <primitive object={sky} ref={skyRef} />
      <points geometry={starGeometry}>
        <pointsMaterial ref={starsMaterialRef} size={1.5} sizeAttenuation={false} color="#ffffff" transparent depthWrite={false} />
      </points>
    </>
  )
}
