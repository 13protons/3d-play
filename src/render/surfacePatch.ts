type Vec3 = [number, number, number]
type SurfaceState = 'flying' | 'landed' | 'crashed'

export interface SurfacePatchFrame {
  position: Vec3
  normal: Vec3
}

export function surfacePatchFrame(radialOut: Vec3): SurfacePatchFrame {
  return {
    position: [0, 0, 0],
    normal: normalize(radialOut, [0, 1, 0]),
  }
}

export function shouldHideBodySphereForLocalSurface(
  bodyId: string,
  vehicleParentId: string,
  surfaceState: SurfaceState,
): boolean {
  return bodyId === vehicleParentId && surfaceState !== 'flying'
}

export function clampCameraAboveLocalSurface(
  cameraPosition: Vec3,
  radialOut: Vec3,
  minHeight: number,
): Vec3 {
  const normal = normalize(radialOut, [0, 1, 0])
  const height = dot(cameraPosition, normal)
  if (height >= minHeight) return cameraPosition
  const correction = minHeight - height
  return [
    clean(cameraPosition[0] + normal[0] * correction),
    clean(cameraPosition[1] + normal[1] * correction),
    clean(cameraPosition[2] + normal[2] * correction),
  ]
}

function normalize(vector: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(...vector)
  return magnitude > 0 && Number.isFinite(magnitude)
    ? [clean(vector[0] / magnitude), clean(vector[1] / magnitude), clean(vector[2] / magnitude)]
    : fallback
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function clean(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}
