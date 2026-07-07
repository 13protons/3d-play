import { CylinderGeometry, Group, Mesh, TorusGeometry } from 'three'
import { brushedMetal } from './materials'

export interface StageBodyParams {
  radius: number
  length: number
  color?: string
  /** Number of evenly spaced rib rings around the body. */
  ribs?: number
}

/**
 * A stage body (tank + skin) centered at the origin, long axis on +Z, spanning
 * ±length/2. Built along Y then rotated so the length runs on Z (matching the
 * part-frame convention Vessel.tsx renders in). Ribs are thin torus rings whose
 * hole axis is already Z.
 */
export function buildStageBody(params: StageBodyParams): Group {
  const { radius, length, color, ribs = 0 } = params
  const group = new Group()
  const skin = brushedMetal(color)

  const body = new CylinderGeometry(radius, radius, length, 32, 1)
  body.rotateX(Math.PI / 2) // Y-length → Z-length
  group.add(new Mesh(body, skin))

  for (let i = 0; i < ribs; i++) {
    const z = -length / 2 + (length * (i + 1)) / (ribs + 1)
    const ring = new TorusGeometry(radius * 1.01, radius * 0.03, 8, 32)
    const rib = new Mesh(ring, skin)
    rib.position.set(0, 0, z)
    group.add(rib)
  }
  return group
}
