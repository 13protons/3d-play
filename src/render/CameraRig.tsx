import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useCameraStore } from '../state/camera'
import { useModeStore } from '../state/mode'
import { useTrajectoriesStore } from '../state/trajectories'
import { evaluateCurve } from '../sim/curves'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// Keep the camera this far above a surface when it's pushed out of a body.
const SURFACE_CLEARANCE = 1.02

export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)

  // Keep the camera just above a followed body's surface so it can't fall through into
  // the planet's interior — the old fixed minDistance let it dive inside anything
  // bigger than its (tiny) value. Falls back to a generous distance for a vehicle.
  const followTargetId = useCameraStore((s) => s.followTargetId)
  const minDistance = useTrajectoriesStore((s) => {
    const body = s.bodies[followTargetId]
    return body ? Math.max(body.radius * SURFACE_CLEARANCE, 2000) : 1e5
  })

  // After the controls move the camera, push it back out of any body it has entered.
  // minDistance only constrains distance from the *followed* target, so orbiting a
  // vehicle near the surface can still sweep the camera through the planet — this
  // clamps against every body's actual sphere instead. Runs after OrbitControls'
  // own frame update so it corrects the final position.
  useFrame(() => {
    if (useModeStore.getState().activeView !== 'orbital') return
    const store = useTrajectoriesStore.getState()
    const targetCurve = store.curves[useCameraStore.getState().followTargetId]
    if (!targetCurve) return
    const t = store.getSimTime()
    const targetPos = evaluateCurve(targetCurve, t)
    for (const body of Object.values(store.bodies)) {
      const bodyCurve = store.curves[body.id]
      if (!bodyCurve) continue
      const bodyPos = evaluateCurve(bodyCurve, t)
      // Body centre in the camera's (follow-target-relative) scene frame.
      const cx = bodyPos[0] - targetPos[0]
      const cy = bodyPos[1] - targetPos[1]
      const cz = bodyPos[2] - targetPos[2]
      const dx = camera.position.x - cx
      const dy = camera.position.y - cy
      const dz = camera.position.z - cz
      const distance = Math.hypot(dx, dy, dz)
      const minRadius = body.radius * SURFACE_CLEARANCE
      if (distance > 0 && distance < minRadius) {
        const scale = minRadius / distance
        camera.position.set(cx + dx * scale, cy + dy * scale, cz + dz * scale)
      }
    }
  }, 1)

  // When follow target changes, reset camera distance to ~4x body radius
  useEffect(() => {
    return useCameraStore.subscribe((state, prev) => {
      if (state.followTargetId === prev.followTargetId) return
      const body = useTrajectoriesStore.getState().bodies[state.followTargetId]
      if (!body || !controlsRef.current) return

      const distance = body.radius * 4
      camera.position.set(0, distance * 0.4, distance)
      controlsRef.current.target.set(0, 0, 0)
      controlsRef.current.update()
    })
  }, [camera])

  return (
    <OrbitControls
      ref={controlsRef}
      minDistance={minDistance}
      maxDistance={1e12}
      enableDamping
      dampingFactor={0.1}
    />
  )
}
