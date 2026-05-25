import type { EulerOrder } from 'three'
import type { BodyMeta } from '../../state/trajectories'
import {
  bodySurfaceOrientationEuler,
  rotatingBodyTransform,
  vehicleBodyTransform,
} from '../rotation'
import {
  orbitalPlanetSurfaceRenderDecision,
  vehiclePlanetSurfaceRenderDecision,
} from './terrainLodPolicy'
import type { Vec3 } from './types'

export interface TerrainRenderData {
  view: 'orbital' | 'vehicle'
  groupPosition: Vec3
  rotation: [number, number, number, EulerOrder]
  cameraDistance: number
  focusDirection: Vec3
  showTerrainTiles: boolean
}

export function resolveOrbitalTerrainRenderData({
  body,
  bodyPosition,
  targetPosition,
  cameraPosition,
  fovRadians,
  viewportHeight,
  simTime,
}: {
  body: BodyMeta
  bodyPosition: Vec3
  targetPosition: Vec3
  cameraPosition: Vec3
  fovRadians: number
  viewportHeight: number
  simTime: number
}): TerrainRenderData | null {
  const scenePosition: Vec3 = [
    bodyPosition[0] - targetPosition[0],
    bodyPosition[1] - targetPosition[1],
    bodyPosition[2] - targetPosition[2],
  ]
  const cameraRelative: Vec3 = [
    cameraPosition[0] - scenePosition[0],
    cameraPosition[1] - scenePosition[1],
    cameraPosition[2] - scenePosition[2],
  ]
  const cameraDistance = Math.hypot(...cameraRelative)
  const surfaceDecision = orbitalPlanetSurfaceRenderDecision({
    bodyRadius: body.radius,
    cameraDistance,
    fovRadians,
    viewportHeight,
  })
  if (!surfaceDecision.showTerrainTiles) return null

  const transform = rotatingBodyTransform(scenePosition)
  return {
    view: 'orbital',
    groupPosition: transform.groupPosition,
    rotation: bodySurfaceOrientationEuler({
      rotationPhase: body.rotationPhase,
      angularVelocity: body.angularVelocity,
      simTime,
      axialTilt: body.axialTilt,
    }),
    cameraDistance,
    focusDirection: normalize(cameraRelative, [1, 0, 0]),
    showTerrainTiles: true,
  }
}

export function resolveVehicleTerrainRenderData({
  body,
  bodyPosition,
  vehiclePosition,
  vehicleParentId,
  cameraPosition,
  fovRadians,
  viewportHeight,
  simTime,
}: {
  body: BodyMeta
  bodyPosition: Vec3
  vehiclePosition: Vec3
  vehicleParentId?: string
  cameraPosition: Vec3
  fovRadians: number
  viewportHeight: number
  simTime: number
}): TerrainRenderData | null {
  const scenePosition: Vec3 = [
    bodyPosition[0] - vehiclePosition[0],
    bodyPosition[1] - vehiclePosition[1],
    bodyPosition[2] - vehiclePosition[2],
  ]
  const vehicleRelative: Vec3 = [
    vehiclePosition[0] - bodyPosition[0],
    vehiclePosition[1] - bodyPosition[1],
    vehiclePosition[2] - bodyPosition[2],
  ]
  const cameraRelative: Vec3 = [
    cameraPosition[0] - scenePosition[0],
    cameraPosition[1] - scenePosition[1],
    cameraPosition[2] - scenePosition[2],
  ]
  const bodyDistance = Math.hypot(...vehicleRelative)
  const localCameraDistance = Math.hypot(...cameraPosition)
  const cameraDistance = Math.hypot(...cameraRelative)
  const surfaceDecision = vehiclePlanetSurfaceRenderDecision({
    bodyId: body.id,
    vehicleParentId,
    bodyRadius: body.radius,
    bodyDistance,
    localCameraDistance,
    cameraDistance,
    fovRadians,
    viewportHeight,
  })
  if (!surfaceDecision.showTerrainTiles) return null

  const transform = vehicleBodyTransform(scenePosition)
  return {
    view: 'vehicle',
    groupPosition: transform.groupPosition,
    rotation: bodySurfaceOrientationEuler({
      rotationPhase: body.rotationPhase,
      angularVelocity: body.angularVelocity,
      simTime,
      axialTilt: body.axialTilt,
    }),
    cameraDistance,
    focusDirection: normalize(vehicleRelative, [1, 0, 0]),
    showTerrainTiles: true,
  }
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(...vector)
  if (!Number.isFinite(magnitude) || magnitude <= 0) return fallback
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
}
