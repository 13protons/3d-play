import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { useModeStore } from '../state/mode'
import { evaluateCurve } from '../sim/curves'

interface VehicleMarkerProps {
  vehicleId: string
}

export function VehicleMarker({ vehicleId }: VehicleMarkerProps) {
  const meshRef = useRef<Mesh>(null)

  useFrame(({ camera }) => {
    if (useModeStore.getState().activeView !== 'orbital') return
    const mesh = meshRef.current
    if (!mesh) return

    const store = useTrajectoriesStore.getState()
    const { followTargetId } = useCameraStore.getState()
    const t = store.getSimTime()

    const curve = store.curves[vehicleId]
    const targetCurve = store.curves[followTargetId]
    if (!curve) return

    const pos = evaluateCurve(curve, t)
    let camX = 0,
      camY = 0,
      camZ = 0
    if (targetCurve) {
      const camPos = evaluateCurve(targetCurve, t)
      camX = camPos[0]
      camY = camPos[1]
      camZ = camPos[2]
    }
    mesh.position.set(pos[0] - camX, pos[1] - camY, pos[2] - camZ)

    // Scale to maintain constant screen size
    const dist = camera.position.distanceTo(mesh.position)
    const scale = dist * 0.008
    mesh.scale.setScalar(Math.max(scale, 1000))
  })

  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#00ff88" />
    </mesh>
  )
}
