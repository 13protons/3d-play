import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group, Mesh } from 'three'
import { useCameraStore } from '../../state/camera'
import { useModeStore } from '../../state/mode'
import { useTrajectoriesStore } from '../../state/trajectories'
import type { BodyMeta } from '../../state/trajectories'
import { evaluateCurve } from '../../sim/curves'
import { BodyMaterial } from '../BodyMaterial'
import { RENDER_LAYERS } from '../renderLayers'
import { generatedTerrainTileSource } from './generatedTileSource'
import { cachedTerrainTilesForIds, bufferGeometryFromTerrainTileData, mergeTerrainTileData, terrainTileSelectionKey } from './tileGeometry'
import { TerrainTileCache } from './tileCache'
import { selectCubeSphereShellTiles } from './tileSelection'
import { minTileLodForBodyRadius } from './terrainLodPolicy'
import { resolveOrbitalTerrainRenderData, resolveVehicleTerrainRenderData } from './terrainRenderData'
import type { TerrainTileId, Vec3 } from './types'

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
  const selectedTileIds = useMemo(() => selectCubeSphereShellTiles({
    bodyId,
    lod: minTileLodForBodyRadius(),
  }), [bodyId])
  const selectedTileKey = useMemo(() => terrainTileSelectionKey(selectedTileIds), [selectedTileIds])
  const renderedTileKeyRef = useRef('')

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
    const fovRadians = 'fov' in camera ? (camera.fov * Math.PI) / 180 : Math.PI / 3
    const cameraPosition: Vec3 = [camera.position.x, camera.position.y, camera.position.z]
    const renderData = vehicleId && view === 'vehicle'
      ? vehicleTerrainRenderData({
          body,
          bodyPos,
          vehicleId,
          cameraPosition,
          fovRadians,
          viewportHeight: viewport.height,
          simTime: t,
        })
      : orbitalTerrainRenderData({
          body,
          bodyPos,
          cameraPosition,
          fovRadians,
          viewportHeight: viewport.height,
          simTime: t,
        })
    if (!renderData) {
      group.visible = false
      return
    }

    group.visible = true
    group.position.set(...renderData.groupPosition)
    group.rotation.set(...renderData.rotation)

    if (renderedTileKeyRef.current !== selectedTileKey) {
      renderedTileKeyRef.current = selectedTileKey
      setTileIds(selectedTileIds)
    }
    if (loadingKeyRef.current !== selectedTileKey) {
      loadingKeyRef.current = selectedTileKey
      void Promise.all(selectedTileIds.map((tileId) => cache.getTile(tileId, { bodyRadius: body.radius })))
        .then(() => setVersion((value) => value + 1))
    }
  })

  if (!body) return null

  return (
    <group ref={groupRef} visible={false}>
      <TerrainTileBatchMesh body={body} cache={cache} renderLayer={renderLayer} tileIds={tileIds} version={version} />
    </group>
  )
}

function TerrainTileBatchMesh({
  body,
  cache,
  renderLayer,
  tileIds,
  version,
}: {
  body: BodyMeta
  cache: TerrainTileCache
  renderLayer: number
  tileIds: TerrainTileId[]
  version: number
}) {
  const geometry = useMemo(() => {
    const tiles = cachedTerrainTilesForIds({
      tileIds,
      getCachedTile: (tileId) => cache.getCachedTile(tileId),
    })
    if (tiles.length === 0) return null
    return bufferGeometryFromTerrainTileData(mergeTerrainTileData(tiles))
    // `version` bumps when async tile loads land in the cache; it is a deliberate
    // cache-bust so the geometry rebuilds even though it isn't referenced directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, tileIds, version])
  const meshRef = useRef<Mesh>(null)

  useFrame(() => {
    meshRef.current?.layers.set(renderLayer)
  })

  if (!geometry) return null

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <BodyMaterial body={body} />
    </mesh>
  )
}

function orbitalTerrainRenderData({
  body,
  bodyPos,
  cameraPosition,
  fovRadians,
  viewportHeight,
  simTime,
}: {
  body: BodyMeta
  bodyPos: Vec3
  cameraPosition: Vec3
  fovRadians: number
  viewportHeight: number
  simTime: number
}) {
  const store = useTrajectoriesStore.getState()
  const targetCurve = store.curves[useCameraStore.getState().followTargetId]
  const targetPos = targetCurve ? evaluateCurve(targetCurve, simTime) as Vec3 : [0, 0, 0] as Vec3
  return resolveOrbitalTerrainRenderData({
    body,
    bodyPosition: bodyPos,
    targetPosition: targetPos,
    cameraPosition,
    fovRadians,
    viewportHeight,
    simTime,
  })
}

function vehicleTerrainRenderData({
  body,
  bodyPos,
  vehicleId,
  cameraPosition,
  fovRadians,
  viewportHeight,
  simTime,
}: {
  body: BodyMeta
  bodyPos: Vec3
  vehicleId: string
  cameraPosition: Vec3
  fovRadians: number
  viewportHeight: number
  simTime: number
}) {
  const store = useTrajectoriesStore.getState()
  const vehicleCurve = store.curves[vehicleId]
  if (!vehicleCurve) return null
  const vehicle = store.vehicles[vehicleId]
  const vehiclePos = evaluateCurve(vehicleCurve, simTime) as Vec3
  return resolveVehicleTerrainRenderData({
    body,
    bodyPosition: bodyPos,
    vehiclePosition: vehiclePos,
    vehicleParentId: vehicle?.parentId,
    cameraPosition,
    fovRadians,
    viewportHeight,
    simTime,
  })
}
