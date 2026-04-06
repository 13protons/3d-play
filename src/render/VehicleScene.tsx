import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Stars, OrbitControls } from '@react-three/drei'
import type { Mesh, PointLight } from 'three'
import { useModeStore } from '../state/mode'
import { useTrajectoriesStore } from '../state/trajectories'
import type { BodyMeta } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'

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
}: {
  bodyId: string
  vehicleId: string
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

    // Floating origin centered on vehicle
    mesh.position.set(
      bodyPos[0] - vehiclePos[0],
      bodyPos[1] - vehiclePos[1],
      bodyPos[2] - vehiclePos[2],
    )

    if (lightRef.current) {
      lightRef.current.position.copy(mesh.position)
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
          <meshStandardMaterial color={body.color} />
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
      <ambientLight intensity={0.08} />
      <Stars radius={1e8} depth={1e8} count={3000} factor={1e6} fade />
      <OrbitControls minDistance={5} maxDistance={1e9} />
      <VehicleMesh />
      {firstVehicle &&
        visibleBodyIds.map((id) => (
          <VehicleBody
            key={id}
            bodyId={id}
            vehicleId={firstVehicle.id}
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
