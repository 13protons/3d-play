import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import type { Group, Mesh } from 'three'
import { useCameraStore } from '../state/camera'
import { useManeuverStore } from '../state/maneuver'
import { useModeStore } from '../state/mode'
import { useOrbitPredictionStore, type OrbitPredictionSnapshot } from '../state/orbitPrediction'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import {
  predictVehicleOrbit,
  type PredictionBodyState,
} from '../sim/orbital/vehiclePrediction'
import {
  anomalyAtTime,
  applyManeuverDeltaV,
  stateAtAnomaly,
  type ManeuverNode,
  type Vec3,
} from '../sim/maneuverNode'
import type { TrajectoryCurve } from '../sim/types'

const RECOMPUTE_INTERVAL_SECONDS = 1

interface ManeuverNodeOverlayProps {
  vehicleId: string
}

interface OverlayState {
  nodePosition: Vec3
  previewPoints: [number, number, number][] | null
}

export function ManeuverNodeOverlay({ vehicleId }: ManeuverNodeOverlayProps) {
  const groupRef = useRef<Group>(null)
  const markerRef = useRef<Mesh>(null)
  const lastSnapshotRef = useRef<OrbitPredictionSnapshot | null>(null)
  const lastNodeRef = useRef<ManeuverNode | null>(null)
  const lastComputedRef = useRef<number | null>(null)
  const [overlay, setOverlay] = useState<OverlayState | null>(null)
  const node = useManeuverStore((s) => s.nodes[vehicleId])
  const vehicle = useTrajectoriesStore((s) => s.vehicles[vehicleId])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    const activeView = useModeStore.getState().activeView
    group.visible = activeView === 'orbital' && overlay !== null

    if (!vehicle || !node) {
      if (overlay !== null) setOverlay(null)
      lastSnapshotRef.current = null
      lastNodeRef.current = null
      lastComputedRef.current = null
      return
    }

    const snapshot = useOrbitPredictionStore.getState().snapshots[vehicleId]
    if (!snapshot) {
      if (overlay !== null) setOverlay(null)
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

    const snapshotChanged = lastSnapshotRef.current !== snapshot
    const nodeChanged = lastNodeRef.current !== node
    const dueForRecompute =
      snapshotChanged ||
      nodeChanged ||
      lastComputedRef.current === null ||
      Math.abs(t - lastComputedRef.current) >= RECOMPUTE_INTERVAL_SECONDS
    if (!dueForRecompute) return

    const computed = computeOverlay({
      snapshot,
      parent,
      parentPosNow: parentPos,
      bodies: store.bodies,
      curves: store.curves,
      simTimeNow: t,
      node,
    })
    lastSnapshotRef.current = snapshot
    lastNodeRef.current = node
    lastComputedRef.current = t
    setOverlay(computed)
  })

  if (!vehicle) return null

  const markerScale = overlay
    ? Math.max(Math.hypot(...overlay.nodePosition) * 0.01, 50_000)
    : 1

  return (
    <group ref={groupRef} visible={false}>
      {overlay && (
        <>
          <mesh ref={markerRef} position={overlay.nodePosition} scale={markerScale}>
            <sphereGeometry args={[1, 16, 12]} />
            <meshBasicMaterial color="#ffcc00" transparent opacity={0.85} />
          </mesh>
          {overlay.previewPoints && (
            <Line
              points={overlay.previewPoints}
              color="#ffcc00"
              lineWidth={1.5}
              opacity={0.75}
              transparent
            />
          )}
        </>
      )}
    </group>
  )
}

function computeOverlay({
  snapshot,
  parent,
  parentPosNow,
  bodies,
  curves,
  simTimeNow,
  node,
}: {
  snapshot: OrbitPredictionSnapshot
  parent: { id: string; gm: number; radius: number }
  parentPosNow: number[]
  bodies: Record<string, { id: string; gm: number; radius: number }>
  curves: Record<string, TrajectoryCurve>
  simTimeNow: number
  node: ManeuverNode
}): OverlayState | null {
  const { elements, simTime: snapshotSimTime } = snapshot
  const anomaly = anomalyAtTime(elements, snapshotSimTime, node.simTime)
  if (anomaly === null) return null
  const stateAtNode = stateAtAnomaly(elements, anomaly)

  const burnMagnitude = Math.hypot(node.deltaV.prograde, node.deltaV.normal, node.deltaV.radial)
  let previewPoints: [number, number, number][] | null = null
  if (burnMagnitude > 1e-3) {
    const newVelocity = applyManeuverDeltaV(stateAtNode, node.deltaV)
    const bodyStates: PredictionBodyState[] = Object.values(bodies).flatMap((body) => {
      const curve = curves[body.id]
      if (!curve) return []
      return [{
        id: body.id,
        gm: body.gm,
        radius: body.radius,
        soiRadius: undefined,
        position: evaluateCurve(curve, simTimeNow),
        velocity: hermiteVelocity(curve, simTimeNow),
      }]
    })
    const parentCurve = curves[parent.id]
    const parentVel = parentCurve ? hermiteVelocity(parentCurve, simTimeNow) : [0, 0, 0]
    const result = predictVehicleOrbit({
      vehicle: {
        position: [
          stateAtNode.position[0] + parentPosNow[0],
          stateAtNode.position[1] + parentPosNow[1],
          stateAtNode.position[2] + parentPosNow[2],
        ],
        velocity: [
          newVelocity[0] + parentVel[0],
          newVelocity[1] + parentVel[1],
          newVelocity[2] + parentVel[2],
        ],
      },
      parent: {
        id: parent.id,
        gm: parent.gm,
        radius: parent.radius,
        position: parentPosNow as [number, number, number],
        velocity: parentVel as [number, number, number],
      },
      bodies: bodyStates,
    })
    previewPoints = result.points.length > 2 ? result.points : null
  }

  return {
    nodePosition: stateAtNode.position,
    previewPoints,
  }
}

function hermiteVelocity(
  curve: TrajectoryCurve,
  t: number,
): [number, number, number] {
  const dt = curve.t1 - curve.t0
  if (dt < 1e-10) return [...curve.v0]

  const s = (t - curve.t0) / dt
  const s2 = s * s
  const dh00 = 6 * s2 - 6 * s
  const dh10 = 3 * s2 - 4 * s + 1
  const dh01 = -6 * s2 + 6 * s
  const dh11 = 3 * s2 - 2 * s

  return [
    (dh00 * curve.p0[0] + dh10 * dt * curve.v0[0] + dh01 * curve.p1[0] + dh11 * dt * curve.v1[0]) / dt,
    (dh00 * curve.p0[1] + dh10 * dt * curve.v0[1] + dh01 * curve.p1[1] + dh11 * dt * curve.v1[1]) / dt,
    (dh00 * curve.p0[2] + dh10 * dt * curve.v0[2] + dh01 * curve.p1[2] + dh11 * dt * curve.v1[2]) / dt,
  ]
}
