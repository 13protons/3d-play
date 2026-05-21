import { useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Stars, OrbitControls } from '@react-three/drei'
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import type { AmbientLight, DirectionalLight, Group, Mesh, MeshBasicMaterial, Object3D } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useModeStore } from '../state/mode'
import { useTrajectoriesStore } from '../state/trajectories'
import type { BodyMeta } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import { evaluateCurveVelocity } from '../sim/curves'
import {
  computeFlightReferenceFrame,
  rotationAxisFromAxialTilt,
} from '../sim/vehicle/referenceFrame'
import {
  isSunOccluded,
  projectDistantSphere,
  type SunOccluder,
  type Vec3,
  vehicleSceneSunLightIntensity,
  vehicleSceneSunLightPosition,
} from './lighting'
import { BodyMaterial } from './BodyMaterial'
import { CraftDebugAxes } from './CraftDebugAxes'
import { cameraUpLerpAlpha, surfaceCameraPosition } from './cameraSmoothing'
import {
  clampCameraAboveLocalSurface,
  SURFACE_CAMERA_MIN_HEIGHT,
  shouldClampCameraAboveLocalSurface,
  shouldHideBodySphereForLocalSurface,
  shouldShowLocalSurfacePatch,
  surfacePatchFrame,
  surfacePatchSizeForCameraDistance,
} from './surfacePatch'
import {
  bodyOrientationEuler,
  bodyRotationAngle,
  vehicleBodyTransform,
} from './rotation'
import { sphereSegmentsForVehicleDistance } from './lod'
import { RENDER_LAYERS, TERRAIN_RENDER_PASSES } from './renderLayers'
import {
  createSphericalCapOverlayGeometryData,
  TERRAIN_OVERLAY_VISUAL_BIAS,
} from './surfaceOverlayGeometry'

const SUN_RENDER_DISTANCE = 5e8

/**
 * Walk up from vehicleParentId to root, collecting ancestors and their direct children.
 * Example: vehicle parentId='earth' -> returns ['earth', 'sun', 'moon']
 */
function getCelestialHierarchy(
  bodies: Record<string, BodyMeta>,
  vehicleParentId: string,
): string[] {
  const result = new Set<string>()
  const allBodies = Object.values(bodies)

  // Walk up from vehicleParentId to root, collecting ancestors
  let currentId: string | null = vehicleParentId
  const ancestors: string[] = []
  while (currentId) {
    ancestors.push(currentId)
    result.add(currentId)
    const body: BodyMeta | undefined = bodies[currentId]
    currentId = body?.parentId ?? null
  }

  // Add all direct children of each ancestor
  for (const ancestorId of ancestors) {
    for (const body of allBodies) {
      if (body.parentId === ancestorId) {
        result.add(body.id)
      }
    }
  }

  return Array.from(result)
}

function VehicleBody({
  bodyId,
  vehicleId,
  visibleBodyIds,
}: {
  bodyId: string
  vehicleId: string
  visibleBodyIds: string[]
}) {
  const spinGroupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const [sphereSegments, setSphereSegments] = useState(32)

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return

    const mesh = meshRef.current
    if (!mesh) return
    mesh.layers.set(RENDER_LAYERS.baseBody)
    const spinGroup = spinGroupRef.current

    const store = useTrajectoriesStore.getState()
    const { curves } = store
    const t = store.getSimTime()

    const bodyCurve = curves[bodyId]
    const vehicleCurve = curves[vehicleId]
    if (!bodyCurve || !vehicleCurve) return
    const vehicle = store.vehicles[vehicleId]
    const controls = store.vehicleControls[vehicleId]
    const hideForLocalSurface = vehicle
      ? shouldHideBodySphereForLocalSurface({
          bodyId,
          vehicleParentId: vehicle.parentId,
          surfaceState: controls?.surfaceState ?? 'flying',
          cameraDistance: camera.position.length(),
        })
      : false

    const bodyPos = evaluateCurve(bodyCurve, t)
    const vehiclePos = evaluateCurve(vehicleCurve, t)
    const bodyDistance = Math.hypot(
      bodyPos[0] - vehiclePos[0],
      bodyPos[1] - vehiclePos[1],
      bodyPos[2] - vehiclePos[2],
    )
    const nextSegments = sphereSegmentsForVehicleDistance(bodyDistance, body.radius)
    setSphereSegments((current) => current === nextSegments ? current : nextSegments)

    const renderBody = body.emissive
      ? projectDistantSphere(
          vehiclePos as Vec3,
          bodyPos as Vec3,
          body.radius,
          SUN_RENDER_DISTANCE,
        )
      : null

    // Floating origin centered on vehicle. Keep placement on the rotating group
    // so spin/tilt changes texture orientation without rotating body position.
    const scenePosition: [number, number, number] = renderBody
      ? renderBody.position
      : [bodyPos[0] - vehiclePos[0], bodyPos[1] - vehiclePos[1], bodyPos[2] - vehiclePos[2]]
    const transform = vehicleBodyTransform(scenePosition)
    if (spinGroup) spinGroup.position.set(...transform.groupPosition)
    mesh.position.set(...transform.meshPosition)

    if (renderBody) {
      mesh.scale.setScalar(renderBody.radius / body.radius)
    } else {
      mesh.scale.setScalar(1)
    }

    if (spinGroup) {
      spinGroup.rotation.set(
        ...bodyOrientationEuler(
          bodyRotationAngle(body.rotationPhase, body.angularVelocity, t),
          body.axialTilt,
        ),
      )
    }

    const sunOccluded = body.emissive
      ? isSunOccluded(
          vehiclePos as Vec3,
          bodyPos as Vec3,
          visibleBodyIds
            .filter((id) => id !== bodyId)
            .map((id): SunOccluder | null => {
              const occluder = store.bodies[id]
              const occluderCurve = curves[id]
              if (!occluder || !occluderCurve) return null
              return {
                id,
                position: evaluateCurve(occluderCurve, t) as Vec3,
                radius: occluder.radius,
              }
            })
            .filter((occluder): occluder is SunOccluder => occluder !== null),
        )
      : false

    mesh.visible = !sunOccluded && !hideForLocalSurface

    if (body.emissive && mesh.material && 'opacity' in mesh.material) {
      const material = mesh.material as MeshBasicMaterial
      material.opacity = sunOccluded ? 0 : 1
      material.transparent = sunOccluded
    }
  })

  if (!body) return null

  return (
    <group>
      <group ref={spinGroupRef}>
        <mesh ref={meshRef}>
          <sphereGeometry args={[body.radius, sphereSegments, sphereSegments]} />
          <BodyMaterial body={body} />
        </mesh>
      </group>
    </group>
  )
}

function VehicleSunLight({
  vehicleId,
  visibleBodyIds,
}: {
  vehicleId: string
  visibleBodyIds: string[]
}) {
  const lightRef = useRef<DirectionalLight>(null)

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return

    const light = lightRef.current
    if (!light) return
    enableRenderableLayers(light.layers)

    const store = useTrajectoriesStore.getState()
    const { curves, bodies } = store
    const t = store.getSimTime()
    const sun = Object.values(bodies).find((body) => body.emissive)
    const sunCurve = sun ? curves[sun.id] : undefined
    const vehicleCurve = curves[vehicleId]
    if (!sun || !sunCurve || !vehicleCurve) return

    const sunPos = evaluateCurve(sunCurve, t) as Vec3
    const vehiclePos = evaluateCurve(vehicleCurve, t) as Vec3
    const sunOccluded = isSunOccluded(
      vehiclePos,
      sunPos,
      visibleBodyIds
        .filter((id) => id !== sun.id)
        .map((id): SunOccluder | null => {
          const occluder = bodies[id]
          const occluderCurve = curves[id]
          if (!occluder || !occluderCurve) return null
          return {
            id,
            position: evaluateCurve(occluderCurve, t) as Vec3,
            radius: occluder.radius,
          }
        })
        .filter((occluder): occluder is SunOccluder => occluder !== null),
    )
    const lightPosition = vehicleSceneSunLightPosition(
      vehiclePos,
      sunPos,
      SUN_RENDER_DISTANCE,
    )
    light.position.set(...lightPosition)
    light.intensity = vehicleSceneSunLightIntensity(sunOccluded)
  })

  return <directionalLight ref={lightRef} intensity={2} />
}

function VehicleAmbientLight() {
  const lightRef = useRef<AmbientLight>(null)

  useFrame(() => {
    const light = lightRef.current
    if (light) enableRenderableLayers(light.layers)
  })

  return <ambientLight ref={lightRef} intensity={0.04} />
}

function VehicleMesh() {
  const groupRef = useRef<Group>(null)
  const vehicles = useTrajectoriesStore((s) => s.vehicles)
  const vehicleControls = useTrajectoriesStore((s) => s.vehicleControls)
  const showRotationAxes = useModeStore((s) => s.showRotationAxes)
  const firstVehicle = Object.values(vehicles)[0]
  const controls = firstVehicle ? vehicleControls[firstVehicle.id] : undefined

  useFrame(() => {
    if (groupRef.current) setLayerRecursively(groupRef.current, RENDER_LAYERS.vehicle)
  })

  return (
    <group ref={groupRef} quaternion={controls?.orientation}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1, 1.5, 4, 8]} />
        <meshStandardMaterial color="#cccccc" />
      </mesh>
      {controls && controls.throttle > 0 && (
        <mesh position={[0, 0, -3]}>
          <sphereGeometry args={[0.7, 12, 8]} />
          <meshBasicMaterial color="#ff8a18" />
        </mesh>
      )}
      {showRotationAxes && (
        <CraftDebugAxes
          length={3}
          aeroForceWorld={controls?.aeroForceWorld}
          orientation={controls?.orientation}
        />
      )}
    </group>
  )
}

function VehicleSurfacePatch() {
  const meshRef = useRef<Mesh>(null)
  const geometryKeyRef = useRef('')
  const camera = useThree((s) => s.camera)
  const vehicles = useTrajectoriesStore((s) => s.vehicles)
  const bodies = useTrajectoriesStore((s) => s.bodies)
  const vehicle = Object.values(vehicles)[0]
  const parent = vehicle ? bodies[vehicle.parentId] : undefined

  useFrame(() => {
    const mesh = meshRef.current
    if (!mesh) return
    mesh.layers.set(RENDER_LAYERS.terrainOverlay)

    const store = useTrajectoriesStore.getState()
    const vehicle = Object.values(store.vehicles)[0]
    if (!vehicle) return
    const parent = store.bodies[vehicle.parentId]
    if (!parent) return
    const controls = store.vehicleControls[vehicle.id]
    const cameraDistance = camera.position.length()
    if (!controls || !shouldShowLocalSurfacePatch({
      surfaceState: controls.surfaceState,
      cameraDistance,
    })) {
      mesh.visible = false
      return
    }

    const radialOut = vehicleRadialOut(vehicle.id, vehicle.parentId)
    if (!radialOut) {
      mesh.visible = false
      return
    }

    const frame = surfacePatchFrame(radialOut)
    const patchSize = surfacePatchSizeForCameraDistance(cameraDistance)
    const geometryKey = `${frame.normal.map((value) => value.toFixed(6)).join(',')}:${parent.radius}:${patchSize.toFixed(0)}`
    if (geometryKeyRef.current !== geometryKey) {
      const geometryData = createSphericalCapOverlayGeometryData({
        centerDirection: frame.normal,
        radius: parent.radius,
        size: patchSize,
        segments: 32,
        visualBias: TERRAIN_OVERLAY_VISUAL_BIAS,
      })
      mesh.geometry.dispose()
      mesh.geometry = bufferGeometryFromData(geometryData)
      geometryKeyRef.current = geometryKey
    }
    mesh.visible = true
    mesh.scale.setScalar(1)
    mesh.position.set(...frame.position)
    mesh.quaternion.identity()
  })

  if (!parent) return null

  return (
    <mesh ref={meshRef} visible={false}>
      <bufferGeometry />
      <BodyMaterial body={parent} />
    </mesh>
  )
}

function VehicleSceneRenderPasses() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return

    gl.clear()
    for (const pass of TERRAIN_RENDER_PASSES) {
      if (pass.clearDepthBefore) gl.clearDepth()
      camera.layers.set(pass.layer)
      gl.render(scene, camera)
    }
  }, 1)

  return null
}

function VehicleSceneContent() {
  const vehicles = useTrajectoriesStore((s) => s.vehicles)
  const bodies = useTrajectoriesStore((s) => s.bodies)

  const vehicleEntries = Object.values(vehicles)
  const firstVehicle = vehicleEntries[0] as
    | (typeof vehicleEntries)[number]
    | undefined

  const visibleBodyIds = firstVehicle
    ? getCelestialHierarchy(bodies, firstVehicle.parentId)
    : []

  return (
    <>
      <VehicleAmbientLight />
      <Stars radius={1e8} depth={1e8} count={3000} factor={1e6} fade />
      <VehicleViewControls />
      <VehicleSceneRenderPasses />
      <VehicleMesh />
      <VehicleSurfacePatch />
      {firstVehicle && (
        <VehicleSunLight
          vehicleId={firstVehicle.id}
          visibleBodyIds={visibleBodyIds}
        />
      )}
      {firstVehicle &&
        visibleBodyIds.map((id) => (
          <VehicleBody
            key={id}
            bodyId={id}
            vehicleId={firstVehicle.id}
            visibleBodyIds={visibleBodyIds}
          />
        ))}
    </>
  )
}

function VehicleViewControls() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const targetUpRef = useRef(new Vector3(0, 1, 0))
  const surfaceCameraInitializedRef = useRef(false)
  const camera = useThree((s) => s.camera)

  useFrame((_, delta) => {
    const store = useTrajectoriesStore.getState()
    const vehicle = Object.values(store.vehicles)[0]
    if (!vehicle) return
    const parent = store.bodies[vehicle.parentId]
    const vehicleCurve = store.curves[vehicle.id]
    const parentCurve = store.curves[vehicle.parentId]
    if (!parent || !vehicleCurve || !parentCurve) return

    const t = store.getSimTime()
    const vehiclePosition = evaluateCurve(vehicleCurve, t) as Vec3
    const parentPosition = evaluateCurve(parentCurve, t) as Vec3
    const vehicleVelocity = evaluateCurveVelocity(vehicleCurve, t) as Vec3
    const parentVelocity = evaluateCurveVelocity(parentCurve, t) as Vec3
    const controls = store.vehicleControls[vehicle.id]
    const relativePosition: Vec3 = [
      vehiclePosition[0] - parentPosition[0],
      vehiclePosition[1] - parentPosition[1],
      vehiclePosition[2] - parentPosition[2],
    ]
    const relativeVelocity: Vec3 = [
      vehicleVelocity[0] - parentVelocity[0],
      vehicleVelocity[1] - parentVelocity[1],
      vehicleVelocity[2] - parentVelocity[2],
    ]
    const frame = computeFlightReferenceFrame({
      relativePosition,
      relativeVelocity,
      parentRadius: parent.radius,
      parentGm: parent.gm,
      parentAngularVelocity: parent.angularVelocity,
      parentRotationAxis: rotationAxisFromAxialTilt(parent.axialTilt),
      surfaceState: controls?.surfaceState ?? 'flying',
    })

    const targetUp = frame.mode === 'surface'
      ? [frame.radialOut[0], frame.radialOut[1], frame.radialOut[2]] as const
      : [0, 1, 0] as const
    targetUpRef.current.set(targetUp[0], targetUp[1], targetUp[2])
    camera.up.lerp(targetUpRef.current, cameraUpLerpAlpha(delta)).normalize()
    if (frame.mode === 'surface' && !surfaceCameraInitializedRef.current) {
      camera.position.set(...surfaceCameraPosition(frame.radialOut, 30, 10))
      surfaceCameraInitializedRef.current = true
    }
    if (shouldClampCameraAboveLocalSurface({
      surfaceState: controls?.surfaceState ?? 'flying',
      referenceMode: frame.mode,
    })) {
      camera.position.set(...clampCameraAboveLocalSurface(
        [camera.position.x, camera.position.y, camera.position.z],
        frame.radialOut,
        SURFACE_CAMERA_MIN_HEIGHT,
      ))
    }
    if (frame.mode !== 'surface') {
      surfaceCameraInitializedRef.current = false
    }
    controlsRef.current?.update()
  })

  return <OrbitControls ref={controlsRef} minDistance={SURFACE_CAMERA_MIN_HEIGHT * 2} maxDistance={1e9} />
}

function vehicleRadialOut(vehicleId: string, parentId: string): Vec3 | undefined {
  const store = useTrajectoriesStore.getState()
  const vehicleCurve = store.curves[vehicleId]
  const parentCurve = store.curves[parentId]
  if (!vehicleCurve || !parentCurve) return undefined

  const t = store.getSimTime()
  const vehiclePosition = evaluateCurve(vehicleCurve, t)
  const parentPosition = evaluateCurve(parentCurve, t)
  const radialOut = new Vector3(
    vehiclePosition[0] - parentPosition[0],
    vehiclePosition[1] - parentPosition[1],
    vehiclePosition[2] - parentPosition[2],
  )
  if (radialOut.lengthSq() === 0) return undefined
  radialOut.normalize()
  return [radialOut.x, radialOut.y, radialOut.z]
}

export function VehicleScene() {
  const active = useModeStore((s) => s.activeView === 'vehicle')

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: active ? 'block' : 'none',
      }}
    >
      <Canvas
        camera={{ position: [0, 10, 30], near: 0.1, far: 1e9, fov: 60 }}
        gl={{ autoClear: false }}
        style={{ width: '100%', height: '100%' }}
      >
        <VehicleSceneContent />
      </Canvas>
    </div>
  )
}

function enableRenderableLayers(layers: { enable: (layer: number) => void }) {
  layers.enable(RENDER_LAYERS.baseBody)
  layers.enable(RENDER_LAYERS.terrainOverlay)
  layers.enable(RENDER_LAYERS.vehicle)
}

function setLayerRecursively(object: Object3D, layer: number) {
  object.layers.set(layer)
  for (const child of object.children) setLayerRecursively(child, layer)
}

function bufferGeometryFromData({
  positions,
  normals,
  uvs,
  indices,
}: ReturnType<typeof createSphericalCapOverlayGeometryData>): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}
