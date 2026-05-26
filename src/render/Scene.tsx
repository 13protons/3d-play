import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import { useTrajectoriesStore } from '../state/trajectories'
import { Body } from './Body'
import { ManeuverNodeOverlay } from './ManeuverNodeOverlay'
import { OrbitMarkers } from './OrbitMarkers'
import { OrbitPrediction } from './OrbitPrediction'
import { VehicleMarker } from './VehicleMarker'
import { VehicleOrbitPrediction } from './VehicleOrbitPrediction'
import { CameraRig } from './CameraRig'
import { RENDER_LAYERS } from './renderLayers'
import { PlanetTerrainTiles } from './terrain/PlanetTerrainTiles'

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
        <PlanetTerrainTiles key={`terrain-${id}`} bodyId={id} renderLayer={RENDER_LAYERS.baseBody} />
      ))}
      {bodyIds.map((id) => (
        <OrbitPrediction key={`prediction-${id}`} bodyId={id} />
      ))}
      {Object.keys(vehicles).map((id) => (
        <VehicleMarker key={`vm-${id}`} vehicleId={id} />
      ))}
      {Object.keys(vehicles).map((id) => (
        <VehicleOrbitPrediction key={`vprediction-${id}`} vehicleId={id} />
      ))}
      {Object.keys(vehicles).map((id) => (
        <OrbitMarkers key={`orbitwp-${id}`} vehicleId={id} />
      ))}
      {Object.keys(vehicles).map((id) => (
        <ManeuverNodeOverlay key={`mnode-${id}`} vehicleId={id} />
      ))}
    </Canvas>
  )
}
