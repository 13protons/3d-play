import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Euler, Quaternion, Vector3 } from 'three'
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
import { selectAdaptiveCubeSphereTiles } from './tileSelection'
import { terrainTileKey } from './tileId'
import { resolveOrbitalTerrainRenderData, resolveVehicleTerrainRenderData } from './terrainRenderData'
import type { TerrainRenderData } from './terrainRenderData'
import type { TerrainTileId, Vec3 } from './types'

// Cap resident tiles so adaptive selection (which churns the working set as the
// camera moves) can't grow memory without bound. Generously above any single frame's
// selection so revisited regions stay warm.
const MAX_RESIDENT_TILES = 4096

// Tile vertices are generated at absolute body coordinates (~6.4e6 m for Earth),
// where float32 resolution is ~0.75 m — enough to make detailed ground visibly swim
// as the planet rotates. We re-base the merged geometry on a render origin near the
// camera so vertices stay small (full precision). Snapping the origin to this grid
// keeps it stable while at rest (so the geometry isn't rebuilt every frame) and only
// shifts it in large, world-position-preserving steps while travelling.
const RENDER_ORIGIN_SNAP_METERS = 1000

function snapToGrid(value: number, grid: number): number {
  return Math.round(value / grid) * grid
}

// Scratch objects reused across frames/instances (render runs single-threaded) to
// transform the camera into a body's local, unrotated frame for tile selection.
const scratchCameraLocal = new Vector3()
const scratchEuler = new Euler()
const scratchQuat = new Quaternion()

function cameraLocalPositionForBody(
  cameraWorld: { x: number; y: number; z: number },
  renderData: TerrainRenderData,
): Vec3 {
  const [gx, gy, gz] = renderData.groupPosition
  scratchCameraLocal.set(cameraWorld.x - gx, cameraWorld.y - gy, cameraWorld.z - gz)
  // Undo the group's body-orientation rotation: localPos = R⁻¹ (worldPos − groupPos).
  scratchEuler.set(...renderData.rotation)
  scratchQuat.setFromEuler(scratchEuler).conjugate()
  scratchCameraLocal.applyQuaternion(scratchQuat)
  return [scratchCameraLocal.x, scratchCameraLocal.y, scratchCameraLocal.z]
}

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
  const [renderOrigin, setRenderOrigin] = useState<Vec3>([0, 0, 0])
  const [version, setVersion] = useState(0)
  const cache = useMemo(
    () => new TerrainTileCache(generatedTerrainTileSource, { maxLoadedTiles: MAX_RESIDENT_TILES }),
    [],
  )
  const renderedTileKeyRef = useRef('')
  // Async tile loads below resolve off the frame loop; don't setState after unmount.
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

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

    // Adaptive LOD: pick tiles by projected screen size around the camera's position
    // in the body's local frame. Sort for a stable key so an unchanged set (just
    // reordered by the quadtree traversal) doesn't trigger a needless rebuild.
    const selectedTileIds = selectAdaptiveCubeSphereTiles({
      bodyId,
      bodyRadius: body.radius,
      cameraLocalPosition: cameraLocalPositionForBody(camera.position, renderData),
      fovRadians,
      viewportHeight: viewport.height,
    })
    selectedTileIds.sort((a, b) => {
      const ka = terrainTileKey(a)
      const kb = terrainTileKey(b)
      return ka < kb ? -1 : ka > kb ? 1 : 0
    })
    const selectedTileKey = terrainTileSelectionKey(selectedTileIds)

    // Render origin = the body-local point under the scene origin (the vehicle in
    // vehicle view), snapped to a grid. Re-basing vertices here makes T + R·origin
    // cancel to ~0 in float64 on the CPU, so the GPU never does the catastrophic
    // float32 subtraction that made the ground swim.
    const [ox, oy, oz] = cameraLocalPositionForBody({ x: 0, y: 0, z: 0 }, renderData)
    const snappedOrigin: Vec3 = [
      snapToGrid(ox, RENDER_ORIGIN_SNAP_METERS),
      snapToGrid(oy, RENDER_ORIGIN_SNAP_METERS),
      snapToGrid(oz, RENDER_ORIGIN_SNAP_METERS),
    ]
    if (
      snappedOrigin[0] !== renderOrigin[0] ||
      snappedOrigin[1] !== renderOrigin[1] ||
      snappedOrigin[2] !== renderOrigin[2]
    ) {
      setRenderOrigin(snappedOrigin)
    }

    if (renderedTileKeyRef.current !== selectedTileKey) {
      renderedTileKeyRef.current = selectedTileKey
      setTileIds(selectedTileIds)
    }
    if (loadingKeyRef.current !== selectedTileKey) {
      loadingKeyRef.current = selectedTileKey
      void Promise.all(selectedTileIds.map((tileId) => cache.getTile(tileId, { bodyRadius: body.radius })))
        .then(() => {
          if (mountedRef.current) setVersion((value) => value + 1)
        })
    }
  })

  if (!body) return null

  return (
    <group ref={groupRef} visible={false}>
      <TerrainTileBatchMesh
        body={body}
        cache={cache}
        renderLayer={renderLayer}
        tileIds={tileIds}
        version={version}
        renderOrigin={renderOrigin}
      />
    </group>
  )
}

function TerrainTileBatchMesh({
  body,
  cache,
  renderLayer,
  tileIds,
  version,
  renderOrigin,
}: {
  body: BodyMeta
  cache: TerrainTileCache
  renderLayer: number
  tileIds: TerrainTileId[]
  version: number
  renderOrigin: Vec3
}) {
  const geometry = useMemo(() => {
    const tiles = cachedTerrainTilesForIds({
      tileIds,
      getCachedTile: (tileId) => cache.getCachedTile(tileId),
    })
    if (tiles.length === 0) return null
    // mergeTerrainTileData allocates a fresh positions array (cached tiles aren't
    // mutated), so re-base it on the render origin in place. The mesh is offset by the
    // same origin below, leaving world positions unchanged but vertex magnitudes small.
    const merged = mergeTerrainTileData(tiles)
    const [ox, oy, oz] = renderOrigin
    const positions = merged.positions
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] -= ox
      positions[i + 1] -= oy
      positions[i + 2] -= oz
    }
    return bufferGeometryFromTerrainTileData(merged)
    // `version` bumps when async tile loads land in the cache; it is a deliberate
    // cache-bust so the geometry rebuilds even though it isn't referenced directly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, tileIds, version, renderOrigin])
  const meshRef = useRef<Mesh>(null)

  // The geometry is rebuilt imperatively (new BufferGeometry) whenever the tile set,
  // render origin, or cache version changes — which happens constantly while moving.
  // R3F doesn't own a geometry passed as a prop, so dispose the previous one ourselves
  // (and on unmount) or its GPU buffers leak each rebuild.
  useEffect(() => {
    if (!geometry) return
    return () => geometry.dispose()
  }, [geometry])

  // The batch mesh's render layer only changes with renderLayer (or when the
  // mesh first mounts as geometry arrives) — set it then, not every frame.
  useEffect(() => {
    meshRef.current?.layers.set(renderLayer)
  }, [renderLayer, geometry])

  if (!geometry) return null

  // Offset the mesh by the render origin the vertices were re-based on, so the group's
  // rotation + position restore the true world position (T + R·origin cancels in
  // float64). Set via the prop so it commits in the same render as the geometry —
  // no frame where the offset and the geometry disagree.
  return (
    <mesh ref={meshRef} geometry={geometry} position={renderOrigin}>
      <BodyMaterial body={body} rim='haze' />
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
