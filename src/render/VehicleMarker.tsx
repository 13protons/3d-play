import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Sprite } from 'three'
import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { useModeStore } from '../state/mode'
import { evaluateCurve } from '../sim/curves'
import { OrbitalMarker } from './OrbitalMarker'
import { spriteWorldSize } from './lod'

const VEHICLE_MARKER_SIZE_PX = 14

interface VehicleMarkerProps {
  vehicleId: string
}

export function VehicleMarker({ vehicleId }: VehicleMarkerProps) {
  const markerRef = useRef<Sprite>(null)
  const viewport = useThree((s) => s.size)

  useFrame(({ camera }) => {
    if (useModeStore.getState().activeView !== 'orbital') return
    const marker = markerRef.current
    if (!marker) return

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
    marker.position.set(pos[0] - camX, pos[1] - camY, pos[2] - camZ)

    const fov = 'fov' in camera ? (camera.fov * Math.PI) / 180 : Math.PI / 3
    const pixelsPerRadian = viewport.height / (2 * Math.tan(fov / 2))
    const distanceToCamera = camera.position.distanceTo(marker.position)
    const markerSize = spriteWorldSize(
      VEHICLE_MARKER_SIZE_PX,
      distanceToCamera,
      pixelsPerRadian,
    )
    marker.scale.set(markerSize, markerSize, 1)
  })

  return <OrbitalMarker ref={markerRef} color="#00ff88" shape="triangle" />
}
