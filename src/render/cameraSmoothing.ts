export function cameraUpLerpAlpha(deltaSeconds: number, settleSeconds = 1.25): number {
  if (deltaSeconds <= 0 || settleSeconds <= 0) return 0
  return Math.min(1, deltaSeconds / settleSeconds)
}

type Vec3 = [number, number, number]

export function surfaceCameraPosition(
  radialOut: Vec3,
  tangentDirection: Vec3,
  tangentDistance: number,
  surfaceHeight: number,
): Vec3 {
  const up = normalize(radialOut, [0, 1, 0])
  // Project the requested horizontal direction (e.g. "south") onto the surface
  // plane; fall back to an arbitrary tangent if it's degenerate / parallel to up.
  const dotTU = tangentDirection[0] * up[0] + tangentDirection[1] * up[1] + tangentDirection[2] * up[2]
  const tangent = normalize(
    [
      tangentDirection[0] - up[0] * dotTU,
      tangentDirection[1] - up[1] * dotTU,
      tangentDirection[2] - up[2] * dotTU,
    ],
    normalize(cross(up, Math.abs(up[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]), [1, 0, 0]),
  )
  return [
    up[0] * surfaceHeight + tangent[0] * tangentDistance,
    up[1] * surfaceHeight + tangent[1] * tangentDistance,
    up[2] * surfaceHeight + tangent[2] * tangentDistance,
  ]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(...vector)
  return magnitude > 0 && Number.isFinite(magnitude)
    ? [vector[0] / magnitude, vector[1] / magnitude, vector[2] / magnitude]
    : fallback
}
