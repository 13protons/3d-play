import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry } from 'three'
import type { Group, Mesh } from 'three'
import { useCameraStore } from '../../state/camera'
import { useModeStore } from '../../state/mode'
import { useTrajectoriesStore } from '../../state/trajectories'
import type { BodyMeta } from '../../state/trajectories'
import { evaluateCurve } from '../../sim/curves'
import { BodyMaterial } from '../BodyMaterial'
import { RENDER_LAYERS } from '../renderLayers'
import {
  bodySurfaceOrientationEuler,
  rotatingBodyTransform,
  vehicleBodyTransform,
} from '../rotation'
import { generatedTerrainTileSource } from './generatedTileSource'
import { TerrainTileCache } from './tileCache'
import { terrainTileKey } from './tileId'
import { selectCubeSphereShellTiles } from './tileSelection'
import {
  minTileLodForBodyRadius,
  maxOrbitalTileCameraDistance,
  maxVehicleTileCameraDistance,
  shouldUseTiledPlanetSurface,
} from './terrainLodPolicy'
import type { TerrainTileData, TerrainTileId, Vec3 } from './types'

interface PlanetTerrainTilesProps {
  bodyId: string
  vehicleId?: string
  renderLayer?: number
  visible?: boolean
}

export function PlanetTerrainTiles({
  bodyId,
  vehicleId,
  renderLayer = RENDER_LAYERS.terrainOverlay,
  visible = true,
}: PlanetTerrainTilesProps) {
  const groupRef = useRef<Group>(null)
  const loadingKeyRef = useRef('')
  const camera = useThree((s) => s.camera)
  const viewport = useThree((s) => s.size)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const [tileIds, setTileIds] = useState<TerrainTileId[]>([])
  const [version, setVersion] = useState(0)
  const cache = useMemo(() => new TerrainTileCache(generatedTerrainTileSource), [])

  useFrame(() => {
    const group = groupRef.current
    if (!group || !body || !visible) return
    group.layers.set(renderLayer)
    const store = useTrajectoriesStore.getState()
    const t = store.getSimTime()
    const bodyCurve = store.curves[bodyId]
    if (!bodyCurve) return

    const view = useModeStore.getState().activeView
    const bodyPos = evaluateCurve(bodyCurve, t) as Vec3
    const placement = vehicleId && view === 'vehicle'
      ? vehicleTerrainPlacement({ body, bodyPos, vehicleId, cameraPosition: [camera.position.x, camera.position.y, camera.position.z] })
      : orbitalTerrainPlacement({
          body,
          bodyPos,
          cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
          fovRadians: 'fov' in camera ? (camera.fov * Math.PI) / 180 : Math.PI / 3,
        })
    if (!placement) {
      group.visible = false
      return
    }
    if (!shouldUseTiledPlanetSurface(projectedDiameterRatio({
      bodyRadius: body.radius,
      cameraDistance: placement.cameraDistance,
      fovRadians: 'fov' in camera ? (camera.fov * Math.PI) / 180 : Math.PI / 3,
      viewportHeight: viewport.height,
    }))) {
      group.visible = false
      return
    }

    group.visible = true
    group.position.set(...placement.groupPosition)
    group.rotation.set(
      ...bodySurfaceOrientationEuler({
        rotationPhase: body.rotationPhase,
        angularVelocity: body.angularVelocity,
        simTime: t,
        axialTilt: body.axialTilt,
      }),
    )

    const selected = selectCubeSphereShellTiles({
      bodyId,
      lod: minTileLodForBodyRadius(),
    })
    const nextKey = selected.map(terrainTileKey).join('|')
    setTileIds((current) => {
      const currentKey = current.map(terrainTileKey).join('|')
      return currentKey === nextKey ? current : selected
    })
    if (loadingKeyRef.current !== nextKey) {
      loadingKeyRef.current = nextKey
      void Promise.all(selected.map((tileId) => cache.getTile(tileId, { bodyRadius: body.radius })))
        .then(() => setVersion((value) => value + 1))
    }
  })

  if (!body) return null

  return (
    <group ref={groupRef} visible={false}>
      {tileIds.map((tileId) => {
        const tile = cache.getCachedTile(tileId)
        if (!tile) return null
        return <TerrainTileMesh key={`${terrainTileKey(tileId)}:${version}`} body={body} renderLayer={renderLayer} tile={tile} />
      })}
    </group>
  )
}

function TerrainTileMesh({
  body,
  renderLayer,
  tile,
}: {
  body: BodyMeta
  renderLayer: number
  tile: TerrainTileData
}) {
  const geometry = useMemo(() => bufferGeometryFromTile(tile), [tile])
  const meshRef = useRef<Mesh>(null)

  useFrame(() => {
    meshRef.current?.layers.set(renderLayer)
  })

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <BodyMaterial body={body} />
    </mesh>
  )
}

function orbitalTerrainPlacement({
  body,
  bodyPos,
  cameraPosition,
  fovRadians,
}: {
  body: BodyMeta
  bodyPos: Vec3
  cameraPosition: Vec3
  fovRadians: number
}) {
  const store = useTrajectoriesStore.getState()
  const targetCurve = store.curves[useCameraStore.getState().followTargetId]
  const t = store.getSimTime()
  const targetPos = targetCurve ? evaluateCurve(targetCurve, t) as Vec3 : [0, 0, 0] as Vec3
  const scenePosition: Vec3 = [
    bodyPos[0] - targetPos[0],
    bodyPos[1] - targetPos[1],
    bodyPos[2] - targetPos[2],
  ]
  const cameraRelative: Vec3 = [
    cameraPosition[0] - scenePosition[0],
    cameraPosition[1] - scenePosition[1],
    cameraPosition[2] - scenePosition[2],
  ]
  const cameraDistance = Math.hypot(cameraRelative[0], cameraRelative[1], cameraRelative[2])
  if (cameraDistance > maxOrbitalTileCameraDistance(body.radius, fovRadians)) return null
  const transform = rotatingBodyTransform(scenePosition)
  return {
    groupPosition: transform.groupPosition,
    cameraDistance,
    focusDirection: normalize(cameraRelative, [1, 0, 0] as Vec3),
  }
}

function vehicleTerrainPlacement({
  body,
  bodyPos,
  vehicleId,
  cameraPosition,
}: {
  body: BodyMeta
  bodyPos: Vec3
  vehicleId: string
  cameraPosition: Vec3
}) {
  const store = useTrajectoriesStore.getState()
  const vehicleCurve = store.curves[vehicleId]
  if (!vehicleCurve) return null
  const vehiclePos = evaluateCurve(vehicleCurve, store.getSimTime()) as Vec3
  const scenePosition: Vec3 = [
    bodyPos[0] - vehiclePos[0],
    bodyPos[1] - vehiclePos[1],
    bodyPos[2] - vehiclePos[2],
  ]
  const vehicleRelative: Vec3 = [
    vehiclePos[0] - bodyPos[0],
    vehiclePos[1] - bodyPos[1],
    vehiclePos[2] - bodyPos[2],
  ]
  const bodyDistance = Math.hypot(vehicleRelative[0], vehicleRelative[1], vehicleRelative[2])
  if (bodyDistance > body.radius * 1.2) return null
  const localCameraDistance = Math.hypot(cameraPosition[0], cameraPosition[1], cameraPosition[2])
  if (localCameraDistance > maxVehicleTileCameraDistance(body.radius)) return null
  const cameraRelative: Vec3 = [
    cameraPosition[0] - scenePosition[0],
    cameraPosition[1] - scenePosition[1],
    cameraPosition[2] - scenePosition[2],
  ]
  const transform = vehicleBodyTransform(scenePosition)
  return {
    groupPosition: transform.groupPosition,
    cameraDistance: Math.hypot(cameraRelative[0], cameraRelative[1], cameraRelative[2]),
    focusDirection: normalize(vehicleRelative, [1, 0, 0] as Vec3),
  }
}

function bufferGeometryFromTile(tile: TerrainTileData): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(tile.positions, 3))
  geometry.setAttribute('normal', new BufferAttribute(tile.normals, 3))
  geometry.setAttribute('uv', new BufferAttribute(tile.uvs, 2))
  geometry.setIndex(new BufferAttribute(tile.indices, 1))
  return geometry
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2])
  if (!Number.isFinite(magnitude) || magnitude <= 0) return fallback
  return [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
}

function projectedDiameterRatio({
  bodyRadius,
  cameraDistance,
  fovRadians,
  viewportHeight,
}: {
  bodyRadius: number
  cameraDistance: number
  fovRadians: number
  viewportHeight: number
}): number {
  const pixelsPerRadian = viewportHeight / (2 * Math.tan(fovRadians / 2))
  return (bodyRadius * 2 * pixelsPerRadian / Math.max(1, cameraDistance)) / viewportHeight
}
