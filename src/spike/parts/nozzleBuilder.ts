import { Group, LatheGeometry, Mesh, Vector2 } from 'three'
import { nozzleMetal } from './materials'

export interface BellNozzleParams {
  throatRadius: number
  exitRadius: number
  length: number
  color?: string
}

/**
 * A bell nozzle: throat (narrow) at z=0, exit (wide, open mouth) at z=-length,
 * opening toward -Z (the vehicle's wake). Profile is revolved about Y from
 * throat (y=0) to exit (y=-length), then rotated so the axis runs on Z.
 * If the bell renders inside-out, reverse the point order or set the material
 * to DoubleSide.
 */
export function buildBellNozzle(params: BellNozzleParams): Group {
  const { throatRadius, exitRadius, length, color } = params
  const steps = 12
  const points: Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const r = throatRadius + (exitRadius - throatRadius) * Math.pow(t, 1.6)
    points.push(new Vector2(r, -t * length))
  }
  const geom = new LatheGeometry(points, 32)
  geom.rotateX(Math.PI / 2) // throat at z=0, exit at z=-length
  const group = new Group()
  group.add(new Mesh(geom, nozzleMetal(color)))
  return group
}
