import type { Vector3 } from 'three'

/**
 * Push a point radially out to a sphere's surface if it's inside it; leave it alone
 * otherwise. Used to keep the camera from entering a body — both the orbital camera
 * (against every body) and the landed vehicle camera (against its parent). Unlike a
 * flat tangent-plane clamp, a sphere lets the camera orbit freely down to just above
 * the ground (e.g. to look up at the sky) without dropping below the surface.
 *
 * Mutates `point` in place (callers pass `camera.position`).
 */
export function clampOutsideSphere(
  point: Vector3,
  centerX: number,
  centerY: number,
  centerZ: number,
  minRadius: number,
): void {
  const dx = point.x - centerX
  const dy = point.y - centerY
  const dz = point.z - centerZ
  const distance = Math.hypot(dx, dy, dz)
  if (distance > 0 && distance < minRadius) {
    const scale = minRadius / distance
    point.set(centerX + dx * scale, centerY + dy * scale, centerZ + dz * scale)
  }
}
