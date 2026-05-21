/**
 * Terrain generators — deterministic, pure math.
 *
 * Shared by the orbital worker (for physics collision/environment patches)
 * and the renderer (for visual LOD mesh generation).
 *
 * Each generator takes a body ID + surface coordinates and returns height data.
 * Generators are registered by name and referenced from body definitions.
 */

export type Vec3 = [number, number, number]

export interface SphericalTerrainSample {
  bodyId: string
  height: number
  radius: number
  normal: Vec3
}

export function sampleSphericalTerrain({
  bodyId,
  bodyRadius,
  direction,
}: {
  bodyId: string
  bodyRadius: number
  direction: Vec3
}): SphericalTerrainSample {
  const normal = normalize(direction, [1, 0, 0])
  return {
    bodyId,
    height: 0,
    radius: bodyRadius,
    normal,
  }
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(vector[0], vector[1], vector[2])
  if (magnitude <= 0 || !Number.isFinite(magnitude)) return fallback
  return [
    clean(vector[0] / magnitude),
    clean(vector[1] / magnitude),
    clean(vector[2] / magnitude),
  ]
}

function clean(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}
