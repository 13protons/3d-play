/**
 * Cube Patch — a flat Float64Array(24) representing gravity sampled at the
 * 6 face centers of a world-axis-aligned cube.
 *
 * Layout (192 bytes):
 *   0–2   Box min (x, y, z)
 *   3–5   Box max (x, y, z)
 *   6–8   Gravity at −X face center
 *   9–11  Gravity at +X face center
 *   12–14 Gravity at −Y face center
 *   15–17 Gravity at +Y face center
 *   18–20 Gravity at −Z face center
 *   21–23 Gravity at +Z face center
 */

// ── Named index constants ──────────────────────────────────────────────

export const CP_MIN_X = 0, CP_MIN_Y = 1, CP_MIN_Z = 2
export const CP_MAX_X = 3, CP_MAX_Y = 4, CP_MAX_Z = 5
export const CP_G_NEG_X = 6   // gravity −X face: [6, 7, 8]
export const CP_G_POS_X = 9   // gravity +X face: [9, 10, 11]
export const CP_G_NEG_Y = 12  // gravity −Y face: [12, 13, 14]
export const CP_G_POS_Y = 15  // gravity +Y face: [15, 16, 17]
export const CP_G_NEG_Z = 18  // gravity −Z face: [18, 19, 20]
export const CP_G_POS_Z = 21  // gravity +Z face: [21, 22, 23]
export const CP_GRAVITY_SIZE = 24

// ── evaluateGravity ────────────────────────────────────────────────────

/**
 * Linear interpolation of gravity within a cube patch.
 *
 * Reconstructs a linear gravity field from 6 face-center samples:
 *   g(r) = g_center + Jx·(x-cx) + Jy·(y-cy) + Jz·(z-cz)
 *
 * where g_center is the average of all face samples and each gradient
 * Jk = (g(+k) - g(-k)) / side_k uses the full difference between
 * opposing faces.
 *
 * @param patch  Float64Array(24) cube patch
 * @param x      world-space x position
 * @param y      world-space y position
 * @param z      world-space z position
 * @param out    3-element array to receive [gx, gy, gz]
 */
export function evaluateGravity(
  patch: Float64Array,
  x: number, y: number, z: number,
  out: [number, number, number],
): void {
  const sX = patch[CP_MAX_X] - patch[CP_MIN_X]
  const sY = patch[CP_MAX_Y] - patch[CP_MIN_Y]
  const sZ = patch[CP_MAX_Z] - patch[CP_MIN_Z]

  // Displacement from cube center
  const dx = x - (patch[CP_MIN_X] + patch[CP_MAX_X]) * 0.5
  const dy = y - (patch[CP_MIN_Y] + patch[CP_MAX_Y]) * 0.5
  const dz = z - (patch[CP_MIN_Z] + patch[CP_MAX_Z]) * 0.5

  // Center value: average of all 6 face-center samples
  const g0x = (patch[CP_G_NEG_X]   + patch[CP_G_POS_X]   + patch[CP_G_NEG_Y]   + patch[CP_G_POS_Y]   + patch[CP_G_NEG_Z]   + patch[CP_G_POS_Z])   / 6
  const g0y = (patch[CP_G_NEG_X+1] + patch[CP_G_POS_X+1] + patch[CP_G_NEG_Y+1] + patch[CP_G_POS_Y+1] + patch[CP_G_NEG_Z+1] + patch[CP_G_POS_Z+1]) / 6
  const g0z = (patch[CP_G_NEG_X+2] + patch[CP_G_POS_X+2] + patch[CP_G_NEG_Y+2] + patch[CP_G_POS_Y+2] + patch[CP_G_NEG_Z+2] + patch[CP_G_POS_Z+2]) / 6

  // Linear field: g(r) = g0 + Jx·dx + Jy·dy + Jz·dz
  // where Jk = (g(+k) - g(-k)) / side_k
  out[0] = g0x
    + (patch[CP_G_POS_X]   - patch[CP_G_NEG_X])   / sX * dx
    + (patch[CP_G_POS_Y]   - patch[CP_G_NEG_Y])   / sY * dy
    + (patch[CP_G_POS_Z]   - patch[CP_G_NEG_Z])   / sZ * dz
  out[1] = g0y
    + (patch[CP_G_POS_X+1] - patch[CP_G_NEG_X+1]) / sX * dx
    + (patch[CP_G_POS_Y+1] - patch[CP_G_NEG_Y+1]) / sY * dy
    + (patch[CP_G_POS_Z+1] - patch[CP_G_NEG_Z+1]) / sZ * dz
  out[2] = g0z
    + (patch[CP_G_POS_X+2] - patch[CP_G_NEG_X+2]) / sX * dx
    + (patch[CP_G_POS_Y+2] - patch[CP_G_NEG_Y+2]) / sY * dy
    + (patch[CP_G_POS_Z+2] - patch[CP_G_NEG_Z+2]) / sZ * dz
}

// ── isInsideInnerBox ───────────────────────────────────────────────────

/**
 * Returns true if (x,y,z) is inside the inner box — 50% inset from each
 * face (25% inset from min, 25% inset from max).
 */
export function isInsideInnerBox(
  patch: Float64Array,
  x: number, y: number, z: number,
): boolean {
  const qx = (patch[CP_MAX_X] - patch[CP_MIN_X]) * 0.25
  const qy = (patch[CP_MAX_Y] - patch[CP_MIN_Y]) * 0.25
  const qz = (patch[CP_MAX_Z] - patch[CP_MIN_Z]) * 0.25

  return (
    x >= patch[CP_MIN_X] + qx && x <= patch[CP_MAX_X] - qx &&
    y >= patch[CP_MIN_Y] + qy && y <= patch[CP_MAX_Y] - qy &&
    z >= patch[CP_MIN_Z] + qz && z <= patch[CP_MAX_Z] - qz
  )
}

// ── computeCubeBounds ──────────────────────────────────────────────────

/**
 * Compute axis-aligned cube bounds centered on (cx, cy, cz).
 *
 * Side length = max(1000, speed * warpRate * dt * 4).
 * Returns [minX, minY, minZ, maxX, maxY, maxZ].
 */
export function computeCubeBounds(
  cx: number, cy: number, cz: number,
  speed: number, warpRate: number, dt: number,
): [number, number, number, number, number, number] {
  const side = Math.max(1000, speed * warpRate * dt * 4)
  const half = side / 2
  return [
    cx - half, cy - half, cz - half,
    cx + half, cy + half, cz + half,
  ]
}
