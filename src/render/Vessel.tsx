/**
 * Assembles part meshes from the vehicle's render mirror (the outside copy of
 * the part tree in the vehicle store). Each part is placed at its body-frame
 * transform — resolved from the tree by the same pure helper the physics
 * aggregation uses — inside a group that carries the craft's orientation and a
 * single metres→scene scale. Staging deactivates parts in the store, so they
 * simply drop out of this render on the next React pass.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4, Quaternion } from 'three'
import type { Group } from 'three'
import { useVehicleStore } from '../state/vehicle'
import { useTrajectoriesStore } from '../state/trajectories'
import { resolvePartTransforms } from '../sim/vehicle/aggregation'
import type { PartDefinition, PartRender } from '../sim/vehicle/parts'
import type { Mat3 } from '../sim/vehicle/mat3'
import { RENDER_LAYERS } from './renderLayers'
import { countRender } from './perfCounters'

/** Metres → scene units. A ~25 m rocket renders at a few units, like the old cylinder. */
const VEHICLE_RENDER_SCALE = 0.15

const DEFAULT_RENDER: PartRender = { shape: 'cylinder', radius: 1.5, length: 4, color: '#cccccc' }

export function Vessel({ vehicleId }: { vehicleId: string }) {
  countRender('Vessel')
  const groupRef = useRef<Group>(null)
  const flameRef = useRef<Group>(null)
  const model = useVehicleStore((s) => s.models[vehicleId])
  const parts = model?.parts
  const defs = useMemo(() => new Map<string, PartDefinition>(model?.partDefs ?? []), [model?.partDefs])

  // Resolve every part's pose once per structural change (staging), not per frame.
  const placed = useMemo(() => {
    if (!parts) return []
    const transforms = resolvePartTransforms(parts)
    return parts
      .filter((p) => p.active)
      .map((p) => {
        const t = transforms.get(p.instanceId)
        const def = defs.get(p.defId)
        if (!t || !def) return null
        return {
          instanceId: p.instanceId,
          position: t.position,
          quaternion: quaternionFromMat3(t.rotation),
          render: def.render ?? DEFAULT_RENDER,
          hasEngine: def.modules.some((m) => m.kind === 'engine'),
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
  }, [parts, defs])

  useFrame(() => {
    const group = groupRef.current
    if (!group) return
    setLayerRecursively(group, RENDER_LAYERS.vehicle)
    const controls = useTrajectoriesStore.getState().vehicleControls[vehicleId]
    if (!controls) return
    const [x, y, z, w] = controls.orientation
    group.quaternion.set(x, y, z, w)
    if (flameRef.current) flameRef.current.visible = controls.throttle > 0
  })

  if (!parts) return null

  return (
    <group ref={groupRef}>
      <group scale={VEHICLE_RENDER_SCALE}>
        {placed.map((p) => (
          <group
            key={p.instanceId}
            position={[p.position[0], p.position[1], p.position[2]]}
            quaternion={[p.quaternion[0], p.quaternion[1], p.quaternion[2], p.quaternion[3]]}
          >
            <PartShape render={p.render} />
            {p.hasEngine && (
              <group ref={flameRef} position={[0, 0, -(p.render.length ?? 4) / 2 - 1]} visible={false}>
                <mesh>
                  <sphereGeometry args={[(p.render.radius ?? 1.5) * 0.6, 12, 8]} />
                  <meshBasicMaterial color="#ff8a18" />
                </mesh>
              </group>
            )}
          </group>
        ))}
      </group>
    </group>
  )
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

function setLayerRecursively(object: { layers: { set: (n: number) => void }, children: unknown[] }, layer: number) {
  object.layers.set(layer)
  for (const child of object.children) setLayerRecursively(child as typeof object, layer)
}
