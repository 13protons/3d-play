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
} from '../sim/orbital/vehiclePrediction'
import type { TrajectoryCurve } from '../sim/types'
import {
  computeFlightReferenceFrame,
  rotationAxisFromAxialTilt,
} from '../sim/vehicle/referenceFrame'
import {
  isVehicleActivelyAccelerating,
  predictionStateForReferenceFrame,
  shouldPredictVehicleOrbit,
  shouldRecomputeVehicleOrbitPrediction,
  shouldRenderVehicleOrbitPrediction,
  vehicleOrbitLineStyle,
} from './vehicleOrbitPredictionMath'

const RECOMPUTE_INTERVAL_SECONDS = 5

interface VehicleOrbitPredictionProps {
  vehicleId: string
}

export function VehicleOrbitPrediction({ vehicleId }: VehicleOrbitPredictionProps) {
  const groupRef = useRef<Group>(null)
  const lastComputedSimTimeRef = useRef<number | null>(null)
  const lastPredictionInputsRef = useRef<readonly unknown[]>([])
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
    group.visible = shouldRenderVehicleOrbitPrediction(activeView, prediction?.points.length ?? 0)
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
    const vehiclePos = evaluateCurve(vehicleCurve, t) as [number, number, number]
    const controls = store.vehicleControls[vehicleId]
    const accelerating = isVehicleActivelyAccelerating(controls)
    const predictionInputs = [vehicleCurve, parentCurve, parentBody, controls] as const
    if (!shouldRecomputeVehicleOrbitPrediction(
      lastComputedSimTimeRef.current,
      t,
      RECOMPUTE_INTERVAL_SECONDS,
      accelerating,
      lastPredictionInputsRef.current,
      predictionInputs,
    )) {
      return
    }
    lastComputedSimTimeRef.current = t
    lastPredictionInputsRef.current = predictionInputs

    const parentVelocity = hermiteVelocity(parentCurve, t)
    const relativePosition: [number, number, number] = [
      vehiclePos[0] - parentPos[0],
      vehiclePos[1] - parentPos[1],
      vehiclePos[2] - parentPos[2],
    ]
    const relativeVelocity: [number, number, number] = [
      vehicleVelocity[0] - parentVelocity[0],
      vehicleVelocity[1] - parentVelocity[1],
      vehicleVelocity[2] - parentVelocity[2],
    ]
    const parentRotationAxis = rotationAxisFromAxialTilt(parentBody.axialTilt)
    const referenceFrame = computeFlightReferenceFrame({
      relativePosition,
      relativeVelocity,
      parentRadius: parentBody.radius,
      parentGm: parentBody.gm,
      parentAngularVelocity: parentBody.angularVelocity,
      parentRotationAxis,
      surfaceState: controls?.surfaceState ?? 'flying',
    })
    const predictionState = predictionStateForReferenceFrame({
      mode: referenceFrame.mode,
      vehiclePosition: vehiclePos,
      vehicleVelocity,
      parentPosition: parentPos as [number, number, number],
      parentVelocity,
      parentAngularVelocity: parentBody.angularVelocity,
      parentRotationAxis,
    })
    if (!shouldPredictVehicleOrbit({
      mode: referenceFrame.mode,
      relativeVelocity: [
        predictionState.vehicle.velocity[0] - parentVelocity[0],
        predictionState.vehicle.velocity[1] - parentVelocity[1],
        predictionState.vehicle.velocity[2] - parentVelocity[2],
      ],
    })) {
      setPrediction(null)
      return
    }
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
      vehicle: predictionState.vehicle,
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
