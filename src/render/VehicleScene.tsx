import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars, OrbitControls } from '@react-three/drei'
import type { Mesh, MeshBasicMaterial, PointLight } from 'three'
import { useModeStore } from '../state/mode'
import { useTrajectoriesStore } from '../state/trajectories'
import type { BodyMeta } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import {
  isSunOccluded,
  projectDistantSphere,
  type SunOccluder,
  type Vec3,
} from './lighting'

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
  const meshRef = useRef<Mesh>(null)
  const lightRef = useRef<PointLight>(null)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return

    const mesh = meshRef.current
    if (!mesh) return

    const store = useTrajectoriesStore.getState()
    const { curves } = store
    const t = store.getSimTime()

    const bodyCurve = curves[bodyId]
    const vehicleCurve = curves[vehicleId]
    if (!bodyCurve || !vehicleCurve) return

    const bodyPos = evaluateCurve(bodyCurve, t)
    const vehiclePos = evaluateCurve(vehicleCurve, t)

    const renderBody = body.emissive
      ? projectDistantSphere(
          vehiclePos as Vec3,
          bodyPos as Vec3,
          body.radius,
          SUN_RENDER_DISTANCE,
        )
      : null

    // Floating origin centered on vehicle. Stars use a projected proxy so the
    // vehicle camera can keep practical clipping while still showing the Sun.
    mesh.position.set(
      renderBody ? renderBody.position[0] : bodyPos[0] - vehiclePos[0],
      renderBody ? renderBody.position[1] : bodyPos[1] - vehiclePos[1],
      renderBody ? renderBody.position[2] : bodyPos[2] - vehiclePos[2],
    )

    if (renderBody) {
      mesh.scale.setScalar(renderBody.radius / body.radius)
    } else {
      mesh.scale.setScalar(1)
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

    mesh.visible = !sunOccluded

    if (lightRef.current) {
      lightRef.current.position.copy(mesh.position)
      lightRef.current.intensity = sunOccluded ? 0 : 2
    }

    if (body.emissive && mesh.material && 'opacity' in mesh.material) {
      const material = mesh.material as MeshBasicMaterial
      material.opacity = sunOccluded ? 0 : 1
      material.transparent = sunOccluded
    }
  })

  if (!body) return null

  return (
    <group>
      <mesh ref={meshRef}>
        <sphereGeometry args={[body.radius, 32, 32]} />
        {body.emissive ? (
          <meshBasicMaterial color={body.color} />
        ) : (
          <meshStandardMaterial
            color={body.color}
            emissive={body.color}
            emissiveIntensity={body.minimumLight}
          />
        )}
      </mesh>
      {body.emissive && (
        <pointLight ref={lightRef} intensity={2} distance={0} decay={0} />
      )}
    </group>
  )
}

function VehicleMesh() {
  return (
    <mesh>
      <cylinderGeometry args={[1, 1.5, 4, 8]} />
      <meshStandardMaterial color="#cccccc" />
    </mesh>
  )
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
      <ambientLight intensity={0.04} />
      <Stars radius={1e8} depth={1e8} count={3000} factor={1e6} fade />
      <OrbitControls minDistance={5} maxDistance={1e9} />
      <VehicleMesh />
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
        style={{ width: '100%', height: '100%' }}
      >
        <VehicleSceneContent />
      </Canvas>
    </div>
  )
}
