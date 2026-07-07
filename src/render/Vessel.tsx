/**
 * Assembles part meshes from the vehicle's render mirror (the outside copy of
 * the part tree in the vehicle store). Each part is placed at its body-frame
 * transform — resolved from the tree by the same pure helper the physics
 * aggregation uses — inside a group that carries the craft's orientation and a
 * single metres→scene scale. Staging deactivates parts in the store, so they
 * simply drop out of this render on the next React pass.
 *
 * When flight debug is on, the FlightDebugOverlay rides inside the same oriented
 * / CoM-pivoted / vehicle-layer group, so its markers line up with the craft.
 */

import { Suspense, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { Matrix4, Quaternion } from 'three'
import type { Group, Mesh } from 'three'
import { useVehicleStore } from '../state/vehicle'
import { useTrajectoriesStore } from '../state/trajectories'
import { useModeStore } from '../state/mode'
import { resolvePartTransforms } from '../sim/vehicle/aggregation'
import type { PartDefinition, PartRender } from '../sim/vehicle/parts'
import { type Mat3, type Vec3, mat3MulVec } from '../sim/vehicle/mat3'
import { RENDER_LAYERS } from './renderLayers'
import { countRender } from './perfCounters'
import { allFinite } from './finite'
import { FlightDebugOverlay, type DebugEngine } from './FlightDebugOverlay'
import { partMeshUrl, usesBakedMesh } from './partMesh'

/** Metres → scene units. A ~25 m rocket renders at a few units, like the old cylinder. */
const VEHICLE_RENDER_SCALE = 0.15

const DEFAULT_RENDER: PartRender = { shape: 'cylinder', radius: 1.5, length: 4, color: '#cccccc' }

interface PlacedPart {
  instanceId: string
  position: Vec3
  quaternion: [number, number, number, number]
  render: PartRender
  meshId?: string
  /** Engine geometry when this part has an engine module. */
  engine?: { direction: Vec3, stage: number, nozzleZ: number }
}

export function Vessel({ vehicleId }: { vehicleId: string }) {
  countRender('Vessel')
  const groupRef = useRef<Group>(null)
  const comRef = useRef<Group>(null)
  const flames = useRef<Map<string, { mesh: Mesh, stage: number }>>(new Map())
  const model = useVehicleStore((s) => s.models[vehicleId])
  const showDebug = useModeStore((s) => s.showRotationAxes)
  const parts = model?.parts
  const defs = useMemo(() => new Map<string, PartDefinition>(model?.partDefs ?? []), [model?.partDefs])

  // Resolve every part's pose once per structural change (staging), not per frame.
  const placed = useMemo<PlacedPart[]>(() => {
    if (!parts) return []
    const transforms = resolvePartTransforms(parts)
    return parts
      .filter((p) => p.active)
      .map((p): PlacedPart | null => {
        const t = transforms.get(p.instanceId)
        const def = defs.get(p.defId)
        if (!t || !def) return null
        const engineMod = def.modules.find((m) => m.kind === 'engine')
        const render = def.render ?? DEFAULT_RENDER
        return {
          instanceId: p.instanceId,
          position: t.position,
          quaternion: quaternionFromMat3(t.rotation),
          render,
          meshId: def.meshId,
          engine: engineMod && engineMod.kind === 'engine'
            ? {
                direction: mat3MulVec(t.rotation, normalize(engineMod.thrustDirection ?? [0, 0, 1])),
                stage: p.stage,
                nozzleZ: -(render.length ?? 4) / 2 - 1,
              }
            : undefined,
        }
      })
      .filter((p): p is PlacedPart => p !== null)
  }, [parts, defs])

  // Engine geometry for the debug overlay (body frame).
  const debugEngines = useMemo<DebugEngine[]>(
    () => placed.filter((p) => p.engine).map((p) => ({ position: p.position, direction: p.engine!.direction, stage: p.engine!.stage })),
    [placed],
  )

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    setLayerRecursively(group, RENDER_LAYERS.vehicle)
    const controls = useTrajectoriesStore.getState().vehicleControls[vehicleId]
    if (!controls) return
    if (allFinite(controls.orientation)) {
      const [x, y, z, w] = controls.orientation
      group.quaternion.set(x, y, z, w)
    }
    // Pivot about the live CoM: the tracked position is the CoM, so offset the
    // parts by −CoM (scaled into scene units) inside the rotated group.
    if (comRef.current) {
      const com = controls.centerOfMass
      if (com && allFinite(com)) comRef.current.position.set(-com[0] * VEHICLE_RENDER_SCALE, -com[1] * VEHICLE_RENDER_SCALE, -com[2] * VEHICLE_RENDER_SCALE)
      else if (!com) comRef.current.position.set(0, 0, 0)
    }
    // Each engine's flame fires only when its stage is the firing one and the
    // throttle is up — so the flame sits at the active stage's nozzle, not the
    // gap between stages (the old shared-ref bug).
    const stage = controls.currentStage ?? 0
    const lit = controls.throttle > 0
    for (const f of flames.current.values()) {
      f.mesh.visible = lit && f.stage === stage
    }
  })

  if (!parts) return null

  return (
    <group ref={groupRef}>
      <group ref={comRef} scale={VEHICLE_RENDER_SCALE}>
        {placed.map((p) => (
          <group
            key={p.instanceId}
            position={[p.position[0], p.position[1], p.position[2]]}
            quaternion={[p.quaternion[0], p.quaternion[1], p.quaternion[2], p.quaternion[3]]}
          >
            {usesBakedMesh(p) ? <BakedPart meshId={p.meshId!} /> : <PartShape render={p.render} />}
            {p.engine && (
              <mesh
                ref={(m) => {
                  if (m) flames.current.set(p.instanceId, { mesh: m, stage: p.engine!.stage })
                  else flames.current.delete(p.instanceId)
                }}
                position={[0, 0, p.engine.nozzleZ]}
                visible={false}
              >
                <sphereGeometry args={[(p.render.radius ?? 1.5) * 0.6, 12, 8]} />
                <meshBasicMaterial color="#ff8a18" />
              </mesh>
            )}
          </group>
        ))}
      </group>
      {showDebug && (
        <FlightDebugOverlay vehicleId={vehicleId} scale={VEHICLE_RENDER_SCALE} engines={debugEngines} />
      )}
    </group>
  )
}

/** A baked .glb part loaded by meshId. Materials travel with the asset. */
function BakedPart({ meshId }: { meshId: string }) {
  return (
    <Suspense fallback={null}>
      <BakedPartMesh meshId={meshId} />
    </Suspense>
  )
}

/** Loads and clones the baked .glb; suspends while loading (see BakedPart's boundary). */
function BakedPartMesh({ meshId }: { meshId: string }) {
  const { scene } = useGLTF(partMeshUrl(meshId))
  const object = useMemo(() => scene.clone(true), [scene])
  return <primitive object={object} />
}

/** A single part's mesh, oriented so its length runs along the part's local +Z. */
function PartShape({ render }: { render: PartRender }) {
  const radius = render.radius ?? 1.5
  const length = render.length ?? 4
  const color = render.color ?? '#cccccc'
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      {render.shape === 'box' ? (
        <boxGeometry args={[radius * 2, length, radius * 2]} />
      ) : render.shape === 'cone' ? (
        <coneGeometry args={[radius, length, 16]} />
      ) : (
        <cylinderGeometry args={[radius, radius, length, 16]} />
      )}
      <meshStandardMaterial color={color} />
    </mesh>
  )
}

/** Quaternion (x, y, z, w) from a row-major 3×3 rotation matrix. */
function quaternionFromMat3(m: Mat3): [number, number, number, number] {
  const matrix = new Matrix4().set(
    m[0], m[1], m[2], 0,
    m[3], m[4], m[5], 0,
    m[6], m[7], m[8], 0,
    0, 0, 0, 1,
  )
  const q = new Quaternion().setFromRotationMatrix(matrix)
  return [q.x, q.y, q.z, q.w]
}

function normalize(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2])
  return m > 0 ? [v[0] / m, v[1] / m, v[2] / m] : [0, 0, 1]
}

function setLayerRecursively(object: { layers: { set: (n: number) => void }, children: unknown[] }, layer: number) {
  object.layers.set(layer)
  for (const child of object.children) setLayerRecursively(child as typeof object, layer)
}
