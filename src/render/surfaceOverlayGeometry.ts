type Vec3 = [number, number, number]
export const TERRAIN_OVERLAY_VISUAL_BIAS = 0

export interface SphericalCapOverlayGeometryData {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

export function createSphericalCapOverlayGeometryData({
  centerDirection,
  radius,
  size,
  segments,
  visualBias,
}: {
  centerDirection: Vec3
  radius: number
  size: number
  segments: number
  visualBias: number
}): SphericalCapOverlayGeometryData {
  const vertexCount = (segments + 1) * (segments + 1)
  const positions = new Float32Array(vertexCount * 3)
  const normals = new Float32Array(vertexCount * 3)
  const uvs = new Float32Array(vertexCount * 2)
  const indices = new Uint32Array(segments * segments * 6)
  const center = normalize(centerDirection, [1, 0, 0])
  const east = normalize(cross([0, 1, 0], center), [0, 0, -1])
  const north = normalize(cross(center, east), [0, 1, 0])
  const angularSize = size / Math.max(radius, 1)
  const renderRadius = radius + visualBias

  let vertex = 0
  for (let y = 0; y <= segments; y++) {
    for (let x = 0; x <= segments; x++) {
      const localX = ((x / segments) - 0.5) * angularSize
      const localY = ((y / segments) - 0.5) * angularSize
      const direction = normalize([
        center[0] + east[0] * localX + north[0] * localY,
        center[1] + east[1] * localX + north[1] * localY,
        center[2] + east[2] * localX + north[2] * localY,
      ], center)

      positions[vertex * 3] = clean(direction[0] * renderRadius - center[0] * radius)
      positions[vertex * 3 + 1] = clean(direction[1] * renderRadius - center[1] * radius)
      positions[vertex * 3 + 2] = clean(direction[2] * renderRadius - center[2] * radius)
      normals[vertex * 3] = direction[0]
      normals[vertex * 3 + 1] = direction[1]
      normals[vertex * 3 + 2] = direction[2]
      const [u, v] = equirectangularUv(direction)
      uvs[vertex * 2] = u
      uvs[vertex * 2 + 1] = v
      vertex++
    }
  }

  let index = 0
  const rowStride = segments + 1
  for (let y = 0; y < segments; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * rowStride + x
      const b = a + 1
      const c = a + rowStride
      const d = c + 1
      indices[index++] = a
      indices[index++] = c
      indices[index++] = b
      indices[index++] = b
      indices[index++] = c
      indices[index++] = d
    }
  }

  return { positions, normals, uvs, indices }
}

function equirectangularUv(direction: Vec3): [number, number] {
  const u = 0.5 + Math.atan2(direction[2], direction[0]) / (Math.PI * 2)
  const v = 0.5 - Math.asin(clamp(direction[1], -1, 1)) / Math.PI
  return [clamp(u, 0, 1), clamp(v, 0, 1)]
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

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clean(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}
