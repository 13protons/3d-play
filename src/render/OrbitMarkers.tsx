import { useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import type { Group } from 'three'
import { useCameraStore } from '../state/camera'
import { placeManeuverNode } from '../state/maneuverActions'
import { useModeStore } from '../state/mode'
import { useOrbitPredictionStore, type OrbitPredictionSnapshot } from '../state/orbitPrediction'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import { computeOrbitWaypoints, type OrbitWaypoints } from '../sim/orbitMarkers'
import { rotationAxisFromAxialTilt } from '../sim/vehicle/referenceFrame'

const MARKER_SIZE_FACTOR = 0.012
const MARKER_MIN_SCALE = 40_000

const MARKER_COLORS = {
  periapsis: '#ff6644',
  apoapsis: '#88ddff',
  ascendingNode: '#66ff88',
  descendingNode: '#ff99cc',
} as const

interface OrbitMarkersProps {
  vehicleId: string
}

export function OrbitMarkers({ vehicleId }: OrbitMarkersProps) {
  const groupRef = useRef<Group>(null)
  const vehicle = useTrajectoriesStore((s) => s.vehicles[vehicleId])
  const [waypoints, setWaypoints] = useState<OrbitWaypoints | null>(null)
  const lastSnapshotRef = useRef<OrbitPredictionSnapshot | null>(null)

  useFrame(() => {
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

    if (lastSnapshotRef.current === snapshot) return
    lastSnapshotRef.current = snapshot
    const referenceAxis = rotationAxisFromAxialTilt(parent.axialTilt)
    setWaypoints(computeOrbitWaypoints(snapshot.elements, referenceAxis))
  })

  if (!vehicle) return null

  return (
    <group ref={groupRef} visible={false}>
      {waypoints?.apoapsis && (
        <WaypointMarker
          vehicleId={vehicleId}
          color={MARKER_COLORS.apoapsis}
          anomaly={waypoints.apoapsis.anomaly}
          position={waypoints.apoapsis.position}
        />
      )}
      {waypoints?.periapsis && (
        <WaypointMarker
          vehicleId={vehicleId}
          color={MARKER_COLORS.periapsis}
          anomaly={waypoints.periapsis.anomaly}
          position={waypoints.periapsis.position}
        />
      )}
      {waypoints?.ascendingNode && (
        <WaypointMarker
          vehicleId={vehicleId}
          color={MARKER_COLORS.ascendingNode}
          anomaly={waypoints.ascendingNode.anomaly}
          position={waypoints.ascendingNode.position}
        />
      )}
      {waypoints?.descendingNode && (
        <WaypointMarker
          vehicleId={vehicleId}
          color={MARKER_COLORS.descendingNode}
          anomaly={waypoints.descendingNode.anomaly}
          position={waypoints.descendingNode.position}
        />
      )}
    </group>
  )
}

function WaypointMarker({
  vehicleId,
  color,
  anomaly,
  position,
}: {
  vehicleId: string
  color: string
  anomaly: number
  position: [number, number, number]
}) {
  const scale = Math.max(Math.hypot(...position) * MARKER_SIZE_FACTOR, MARKER_MIN_SCALE)

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    placeManeuverNode(vehicleId, { kind: 'anomaly', anomaly })
  }

  return (
    <mesh position={position} scale={scale} onClick={handleClick}>
      <sphereGeometry args={[1, 12, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} />
    </mesh>
  )
}
