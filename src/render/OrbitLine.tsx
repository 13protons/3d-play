import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import type { Group } from 'three'
import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { evaluateCurve } from '../sim/curves'
import { stateToElements, sampleOrbit } from '../sim/orbital/kepler'

const ORBIT_POINTS = 128
const UPDATE_INTERVAL_MS = 500

interface OrbitLineProps {
  bodyId: string
}

/**
 * Renders a Keplerian orbit prediction for a body around its parent.
 * Points are parent-relative; the group tracks the parent's camera-relative position.
 */
export function OrbitLine({ bodyId }: OrbitLineProps) {
  const groupRef = useRef<Group>(null)
  const lastUpdateRef = useRef(0)
  const [points, setPoints] = useState<[number, number, number][]>([])

  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const parentId = body?.parentId

  useFrame(() => {
    const group = groupRef.current
    if (!group || !parentId) return

    const { curves, simTime, warpRate, lastUpdateWallTime, bodies } =
      useTrajectoriesStore.getState()
    const { followTargetId } = useCameraStore.getState()

    const bodyCurve = curves[bodyId]
    const parentCurve = curves[parentId]
    const targetCurve = curves[followTargetId]
    const parentBody = bodies[parentId]

    if (!bodyCurve || !parentCurve || !parentBody) return

    const wallDelta = (performance.now() - lastUpdateWallTime) / 1000
    const t = simTime + wallDelta * warpRate

    // Position the group at the parent's camera-relative position
    const parentPos = evaluateCurve(parentCurve, t)
    let camX = 0, camY = 0, camZ = 0
    if (targetCurve) {
      const camPos = evaluateCurve(targetCurve, t)
      camX = camPos[0]; camY = camPos[1]; camZ = camPos[2]
    }
    group.position.set(
      parentPos[0] - camX,
      parentPos[1] - camY,
      parentPos[2] - camZ,
    )

    // Recompute orbit shape periodically
    const now = performance.now()
    if (now - lastUpdateRef.current > UPDATE_INTERVAL_MS) {
      lastUpdateRef.current = now

      const bodyPos = evaluateCurve(bodyCurve, t)
      const parentAbs = parentPos

      const relPos: [number, number, number] = [
        bodyPos[0] - parentAbs[0],
        bodyPos[1] - parentAbs[1],
        bodyPos[2] - parentAbs[2],
      ]

      const bodyVel = hermiteVelocity(bodyCurve, t)
      const parentVel = hermiteVelocity(parentCurve, t)
      const relVel: [number, number, number] = [
        bodyVel[0] - parentVel[0],
        bodyVel[1] - parentVel[1],
        bodyVel[2] - parentVel[2],
      ]

      const elements = stateToElements(relPos, relVel, parentBody.mass)
      const orbitPts = sampleOrbit(elements, ORBIT_POINTS)
      setPoints(orbitPts)
    }
  })

  if (!parentId) return null

  return (
    <group ref={groupRef}>
      {points.length > 2 && (
        <Line
          points={points}
          color="#5566aa"
          lineWidth={1}
          transparent
          opacity={0.4}
        />
      )}
    </group>
  )
}

/** Evaluate the Hermite spline derivative at time t to get velocity. */
function hermiteVelocity(
  curve: { p0: [number, number, number]; v0: [number, number, number]; t0: number; p1: [number, number, number]; v1: [number, number, number]; t1: number },
  t: number,
): [number, number, number] {
  const dt = curve.t1 - curve.t0
  if (dt < 1e-10) return [...curve.v0] as [number, number, number]

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
