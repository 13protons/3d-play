import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import type { Group } from 'three'
import { useCameraStore } from '../state/camera'
import { useModeStore } from '../state/mode'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import {
  predictVehicleOrbit,
  type PredictionBodyState,
  type VehicleOrbitPrediction as VehicleOrbitPredictionResult,
  type VehicleOrbitPredictionStatus,
} from '../sim/orbital/vehiclePrediction'
import type { TrajectoryCurve } from '../sim/types'

const RECOMPUTE_INTERVAL_SECONDS = 5
const ACCELERATING_SPEED_DELTA = 0.005

interface VehicleOrbitPredictionProps {
  vehicleId: string
}

interface VehicleOrbitLineStyle {
  color: string
  lineWidth: number
  opacity: number
}

export function shouldRenderVehicleOrbitPrediction(
  activeView: 'orbital' | 'vehicle',
  pointCount: number,
): boolean {
  return activeView === 'orbital' && pointCount > 2
}

export function shouldRecomputeVehicleOrbitPrediction(
  lastComputedSimTime: number | null,
  currentSimTime: number,
  intervalSeconds: number,
  accelerating: boolean,
): boolean {
  return (
    accelerating ||
    lastComputedSimTime === null ||
    currentSimTime - lastComputedSimTime >= intervalSeconds
  )
}

export function vehicleOrbitLineStyle(
  status: VehicleOrbitPredictionStatus,
): VehicleOrbitLineStyle {
  if (status === 'escape') return { color: '#f0b028', lineWidth: 3, opacity: 1 }
  if (status === 'encounter') return { color: '#ff5a4f', lineWidth: 3, opacity: 1 }
  if (status === 'strong-perturbation') {
    return { color: '#d6a64a', lineWidth: 3, opacity: 1 }
  }
  if (status === 'invalid') return { color: '#666666', lineWidth: 2, opacity: 1 }
  return { color: '#28f0a0', lineWidth: 3, opacity: 1 }
}

export function VehicleOrbitPrediction({ vehicleId }: VehicleOrbitPredictionProps) {
  const groupRef = useRef<Group>(null)
  const lastComputedSimTimeRef = useRef<number | null>(null)
  const lastVelocityRef = useRef<[number, number, number] | null>(null)
  const [prediction, setPrediction] = useState<VehicleOrbitPredictionResult | null>(null)
  const vehicle = useTrajectoriesStore((s) => s.vehicles[vehicleId])
  const style = useMemo(
    () => vehicleOrbitLineStyle(prediction?.status ?? 'invalid'),
    [prediction?.status],
  )

  useFrame(() => {
    const group = groupRef.current
    if (!group || !vehicle) return

    const activeView = useModeStore.getState().activeView
    group.visible = shouldRenderVehicleOrbitPrediction(
      activeView,
      prediction?.points.length ?? 0,
    )
    if (activeView !== 'orbital') return

    const store = useTrajectoriesStore.getState()
    const { curves, bodies } = store
    const vehicleCurve = curves[vehicleId]
    const parentCurve = curves[vehicle.parentId]
    const parentBody = bodies[vehicle.parentId]
    if (!vehicleCurve || !parentCurve || !parentBody) {
      group.visible = false
      return
    }

    const t = store.getSimTime()
    const parentPos = evaluateCurve(parentCurve, t)
    const targetCurve = curves[useCameraStore.getState().followTargetId]
    const targetPos = targetCurve ? evaluateCurve(targetCurve, t) : [0, 0, 0]
    group.position.set(
      parentPos[0] - targetPos[0],
      parentPos[1] - targetPos[1],
      parentPos[2] - targetPos[2],
    )

    const vehicleVelocity = hermiteVelocity(vehicleCurve, t)
    const accelerating = isAccelerating(lastVelocityRef.current, vehicleVelocity)
    lastVelocityRef.current = vehicleVelocity
    if (!shouldRecomputeVehicleOrbitPrediction(
      lastComputedSimTimeRef.current,
      t,
      RECOMPUTE_INTERVAL_SECONDS,
      accelerating,
    )) {
      return
    }
    lastComputedSimTimeRef.current = t

    const vehiclePos = evaluateCurve(vehicleCurve, t)
    const parentVelocity = hermiteVelocity(parentCurve, t)
    const bodyStates = Object.values(bodies).flatMap((body): PredictionBodyState[] => {
      const curve = curves[body.id]
      if (!curve) return []
      return [{
        id: body.id,
        gm: body.gm,
        radius: body.radius,
        soiRadius: undefined,
        position: evaluateCurve(curve, t),
        velocity: hermiteVelocity(curve, t),
      }]
    })

    setPrediction(predictVehicleOrbit({
      vehicle: { position: vehiclePos, velocity: vehicleVelocity },
      parent: {
        id: parentBody.id,
        gm: parentBody.gm,
        radius: parentBody.radius,
        position: parentPos,
        velocity: parentVelocity,
      },
      bodies: bodyStates,
    }))
  })

  if (!vehicle) return null

  return (
    <group ref={groupRef} visible={false}>
      {prediction && prediction.points.length > 2 && (
        <Line
          points={prediction.points}
          color={style.color}
          lineWidth={style.lineWidth}
          opacity={style.opacity}
        />
      )}
    </group>
  )
}

function isAccelerating(
  previousVelocity: [number, number, number] | null,
  currentVelocity: [number, number, number],
): boolean {
  if (!previousVelocity) return true
  return Math.hypot(
    currentVelocity[0] - previousVelocity[0],
    currentVelocity[1] - previousVelocity[1],
    currentVelocity[2] - previousVelocity[2],
  ) > ACCELERATING_SPEED_DELTA
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
