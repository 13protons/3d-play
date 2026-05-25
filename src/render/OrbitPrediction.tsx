import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import type { Group } from 'three'
import { useCameraStore } from '../state/camera'
import { useModeStore } from '../state/mode'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import { sampleOrbitAtTrueAnomalies, stateToElements } from '../sim/orbital/kepler'
import type { TrajectoryCurve } from '../sim/types'
import {
  orbitLineStyleForBody,
  predictionTrueAnomalies,
  shouldRecomputeOrbitPrediction,
  splitOrbitLineSegments,
} from './orbitPredictionMath'

const ORBIT_SEGMENTS = 192
const FOCUS_HALF_ANGLE = Math.PI / 18
const FOCUS_SEGMENTS = 48
const RECOMPUTE_INTERVAL_SECONDS = 600

interface OrbitPredictionProps {
  bodyId: string
}

interface PredictionGeometry {
  segments: [number, number, number][][]
}

export function OrbitPrediction({ bodyId }: OrbitPredictionProps) {
  const groupRef = useRef<Group>(null)
  const lastComputedSimTimeRef = useRef<number | null>(null)
  const lastPredictionInputsRef = useRef<readonly unknown[]>([])
  const [prediction, setPrediction] = useState<PredictionGeometry | null>(null)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const parentId = body?.parentId
  const followTargetId = useCameraStore((s) => s.followTargetId)
  const style = useMemo(
    () => orbitLineStyleForBody(bodyId, followTargetId),
    [bodyId, followTargetId],
  )

  useFrame(() => {
    const group = groupRef.current
    if (!group || !parentId) return

    const inOrbitalView = useModeStore.getState().activeView === 'orbital'
    group.visible = inOrbitalView
    if (!inOrbitalView) return

    const store = useTrajectoriesStore.getState()
    const { curves, bodies } = store
    const { followTargetId } = useCameraStore.getState()
    const parentBody = bodies[parentId]
    const bodyCurve = curves[bodyId]
    const parentCurve = curves[parentId]
    const targetCurve = curves[followTargetId]

    if (!parentBody || !bodyCurve || !parentCurve) {
      group.visible = false
      return
    }

    const t = store.getSimTime()
    const parentPos = evaluateCurve(parentCurve, t)

    let camX = 0
    let camY = 0
    let camZ = 0
    if (targetCurve) {
      const camPos = evaluateCurve(targetCurve, t)
      camX = camPos[0]
      camY = camPos[1]
      camZ = camPos[2]
    }
    group.position.set(
      parentPos[0] - camX,
      parentPos[1] - camY,
      parentPos[2] - camZ,
    )

    const predictionInputs = [bodyCurve, parentCurve, parentBody, body] as const
    if (!shouldRecomputeOrbitPrediction(
      lastComputedSimTimeRef.current,
      t,
      RECOMPUTE_INTERVAL_SECONDS,
      lastPredictionInputsRef.current,
      predictionInputs,
    )) {
      return
    }

    lastComputedSimTimeRef.current = t
    lastPredictionInputsRef.current = predictionInputs
    const bodyPos = evaluateCurve(bodyCurve, t)
    const bodyVel = hermiteVelocity(bodyCurve, t)
    const parentVel = hermiteVelocity(parentCurve, t)
    const relPos: [number, number, number] = [
      bodyPos[0] - parentPos[0],
      bodyPos[1] - parentPos[1],
      bodyPos[2] - parentPos[2],
    ]
    const relVel: [number, number, number] = [
      bodyVel[0] - parentVel[0],
      bodyVel[1] - parentVel[1],
      bodyVel[2] - parentVel[2],
    ]

    const elements = stateToElements(relPos, relVel, parentBody.gm)
    const anomalies = predictionTrueAnomalies(
      elements.ta,
      ORBIT_SEGMENTS,
      FOCUS_HALF_ANGLE,
      FOCUS_SEGMENTS,
    )
    const points = sampleOrbitAtTrueAnomalies(elements, anomalies)
    const segments = splitOrbitLineSegments(points, relPos, body.radius * 1.2)
    setPrediction({
      segments,
    })
    group.visible = segments.some((segment) => segment.length > 1)
  })

  if (!parentId) return null

  return (
    <group ref={groupRef} visible={false}>
      {prediction?.segments.map((points, index) => points.length > 1 && (
        <Line
          key={index}
          points={points}
          color={style.color}
          lineWidth={style.lineWidth}
          opacity={style.opacity}
        />
      ))}
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
