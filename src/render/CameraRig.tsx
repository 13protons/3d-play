import { useRef, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useCameraStore } from '../state/camera'
import { useTrajectoriesStore } from '../state/trajectories'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const camera = useThree((s) => s.camera)

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
      minDistance={1e5}
      maxDistance={1e12}
      enableDamping
      dampingFactor={0.1}
    />
  )
}
