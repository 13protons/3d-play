import { useRef, useState } from 'react'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import type { Group, Sprite } from 'three'
import { useCameraStore } from '../state/camera'
import { placeManeuverNode } from '../state/maneuverActions'
import { useModeStore } from '../state/mode'
import { useOrbitPredictionStore, type OrbitPredictionSnapshot } from '../state/orbitPrediction'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import { computeOrbitWaypoints, type OrbitWaypoints } from '../sim/orbitMarkers'
import { rotationAxisFromAxialTilt } from '../sim/vehicle/referenceFrame'
import { spriteWorldSize } from './lod'
import { WaypointMarker, type WaypointKind } from './WaypointMarker'

const WAYPOINT_MARKER_SIZE_PX = 18

interface OrbitMarkersProps {
  vehicleId: string
}

type SpriteRefs = Partial<Record<WaypointKind, Sprite | null>>

export function OrbitMarkers({ vehicleId }: OrbitMarkersProps) {
  const groupRef = useRef<Group>(null)
  const spriteRefs = useRef<SpriteRefs>({})
  const vehicle = useTrajectoriesStore((s) => s.vehicles[vehicleId])
  const [waypoints, setWaypoints] = useState<OrbitWaypoints | null>(null)
  const lastSnapshotRef = useRef<OrbitPredictionSnapshot | null>(null)
  const viewport = useThree((s) => s.size)

  useFrame(({ camera }) => {
    const group = groupRef.current
    if (!group || !vehicle) return
    const activeView = useModeStore.getState().activeView
    group.visible = activeView === 'orbital' && waypoints !== null
    if (activeView !== 'orbital') return

    const snapshot = useOrbitPredictionStore.getState().snapshots[vehicleId]
    if (!snapshot) {
      if (waypoints !== null) setWaypoints(null)
      lastSnapshotRef.current = null
      return
    }

    const store = useTrajectoriesStore.getState()
    const parent = store.bodies[vehicle.parentId]
    const parentCurve = store.curves[vehicle.parentId]
    if (!parent || !parentCurve) return

    const t = store.getSimTime()
    const parentPos = evaluateCurve(parentCurve, t)
    const targetCurve = store.curves[useCameraStore.getState().followTargetId]
    const targetPos = targetCurve ? evaluateCurve(targetCurve, t) : [0, 0, 0]
    group.position.set(
      parentPos[0] - targetPos[0],
      parentPos[1] - targetPos[1],
      parentPos[2] - targetPos[2],
    )

    if (lastSnapshotRef.current !== snapshot) {
      lastSnapshotRef.current = snapshot
      const referenceAxis = rotationAxisFromAxialTilt(parent.axialTilt)
      setWaypoints(computeOrbitWaypoints(snapshot.elements, referenceAxis))
    }

    // Screen-space sizing so markers stay readable at any zoom.
    const fov = 'fov' in camera ? (camera.fov * Math.PI) / 180 : Math.PI / 3
    const pixelsPerRadian = viewport.height / (2 * Math.tan(fov / 2))
    for (const sprite of Object.values(spriteRefs.current)) {
      if (!sprite) continue
      const wx = group.position.x + sprite.position.x
      const wy = group.position.y + sprite.position.y
      const wz = group.position.z + sprite.position.z
      const dist = Math.hypot(
        camera.position.x - wx,
        camera.position.y - wy,
        camera.position.z - wz,
      )
      const size = spriteWorldSize(WAYPOINT_MARKER_SIZE_PX, dist, pixelsPerRadian)
      sprite.scale.set(size, size, 1)
    }
  })

  if (!vehicle) return null

  const onWaypointClick = (anomaly: number) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    placeManeuverNode(vehicleId, { kind: 'anomaly', anomaly })
  }

  const setSpriteRef = (kind: WaypointKind) => (sprite: Sprite | null) => {
    spriteRefs.current[kind] = sprite
  }

  return (
    <group ref={groupRef} visible={false}>
      {waypoints?.apoapsis && (
        <WaypointMarker
          ref={setSpriteRef('apoapsis')}
          kind="apoapsis"
          position={waypoints.apoapsis.position}
          onClick={onWaypointClick(waypoints.apoapsis.anomaly)}
        />
      )}
      {waypoints?.periapsis && (
        <WaypointMarker
          ref={setSpriteRef('periapsis')}
          kind="periapsis"
          position={waypoints.periapsis.position}
          onClick={onWaypointClick(waypoints.periapsis.anomaly)}
        />
      )}
      {waypoints?.ascendingNode && (
        <WaypointMarker
          ref={setSpriteRef('ascendingNode')}
          kind="ascendingNode"
          position={waypoints.ascendingNode.position}
          onClick={onWaypointClick(waypoints.ascendingNode.anomaly)}
        />
      )}
      {waypoints?.descendingNode && (
        <WaypointMarker
          ref={setSpriteRef('descendingNode')}
          kind="descendingNode"
          position={waypoints.descendingNode.position}
          onClick={onWaypointClick(waypoints.descendingNode.anomaly)}
        />
      )}
    </group>
  )
}
