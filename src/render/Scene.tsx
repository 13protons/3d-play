import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { useTrajectoriesStore } from '../state/trajectories'
import { Body } from './Body'
import { OrbitTrace } from './OrbitTrace'
import { VehicleMarker } from './VehicleMarker'
import { CameraRig } from './CameraRig'

export function Scene() {
  const bodies = useTrajectoriesStore((s) => s.bodies)
  const vehicles = useTrajectoriesStore((s) => s.vehicles)
  const bodyIds = Object.keys(bodies)

  return (
    <Canvas
      camera={{
        position: [0, 2e7, 3e7],
        near: 1000,
        far: 1e15,
        fov: 60,
      }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
      }}
    >
      <ambientLight intensity={0.04} />
      <Stars radius={1e14} depth={1e14} count={3000} factor={1e12} fade />
      <CameraRig />
      {bodyIds.map((id) => (
        <Body key={id} bodyId={id} />
      ))}
      {bodyIds.map((id) => (
        <OrbitTrace key={`trace-${id}`} bodyId={id} />
      ))}
      {Object.keys(vehicles).map((id) => (
        <VehicleMarker key={`vm-${id}`} vehicleId={id} />
      ))}
      {Object.keys(vehicles).map((id) => (
        <OrbitTrace key={`vtrace-${id}`} bodyId={id} />
      ))}
    </Canvas>
  )
}
