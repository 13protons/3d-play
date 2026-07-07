import { CircleGeometry, Group, LatheGeometry, Mesh, Vector2 } from 'three'
import { heatShield, paintedBand } from './materials'

export interface CapsuleParams {
  radius: number
  length: number
  color?: string
}

/**
 * A gumdrop capsule centered on the origin, long axis +Z, spanning ±length/2.
 * Wide base at -Z (with a heat-shield disc), tapered nose at +Z.
 */
export function buildCapsule(params: CapsuleParams): Group {
  const { radius, length, color } = params
  const steps = 16
  const points: Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps // 0 = base, 1 = nose
    const y = -length / 2 + t * length
    const r = radius * Math.cos((t * Math.PI) / 2) // radius at base → ~0 at nose
    points.push(new Vector2(Math.max(r, 0.02), y))
  }
  const shell = new LatheGeometry(points, 32)
  shell.rotateX(Math.PI / 2) // base at -Z, nose at +Z
  const group = new Group()
  group.add(new Mesh(shell, paintedBand(color)))

  const disc = new CircleGeometry(radius, 32)
  disc.rotateY(Math.PI) // face -Z
  const base = new Mesh(disc, heatShield())
  base.position.set(0, 0, -length / 2)
  group.add(base)
  return group
}
