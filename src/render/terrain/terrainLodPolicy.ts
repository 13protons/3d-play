const DEFAULT_TILE_ACTIVATION_SCREEN_RATIO = 0.12
const MIN_TILE_LOD = 4

export type PlanetSurfaceRenderMode = 'sphere' | 'tiles'

export function tileEdgeMeters(bodyRadius: number, lod: number): number {
  return (bodyRadius * 2) / 2 ** lod
}

export function shouldUseTiledPlanetSurface(
  projectedDiameterRatio: number,
  threshold = DEFAULT_TILE_ACTIVATION_SCREEN_RATIO,
): boolean {
  return planetSurfaceRenderMode(projectedDiameterRatio, threshold) === 'tiles'
}

export function shouldHideFallbackSphereForTiledSurface(
  projectedDiameterRatio: number,
  threshold = DEFAULT_TILE_ACTIVATION_SCREEN_RATIO,
): boolean {
  return planetSurfaceRenderMode(projectedDiameterRatio, threshold) === 'tiles'
}

export function planetSurfaceRenderMode(
  projectedDiameterRatio: number,
  threshold = DEFAULT_TILE_ACTIVATION_SCREEN_RATIO,
): PlanetSurfaceRenderMode {
  return projectedDiameterRatio >= threshold ? 'tiles' : 'sphere'
}

export function minTileLodForBodyRadius(): number {
  return MIN_TILE_LOD
}

export function maxVehicleTileCameraDistance(bodyRadius: number): number {
  return bodyRadius * 0.02
}

export function maxOrbitalTileCameraDistance(
  bodyRadius: number,
  fovRadians = Math.PI / 3,
  minProjectedDiameterRatio = DEFAULT_TILE_ACTIVATION_SCREEN_RATIO,
): number {
  return bodyRadius / (minProjectedDiameterRatio * Math.tan(fovRadians / 2))
}

export function maxTileLodForBodyRadius(bodyRadius: number): number {
  if (bodyRadius >= 100_000_000) return 20
  if (bodyRadius >= 20_000_000) return 18
  if (bodyRadius >= 1_000_000) return 16
  return Math.max(MIN_TILE_LOD, Math.min(16, Math.ceil(Math.log2((bodyRadius * 2) / 50))))
}

export function tileLodForCameraDistance({
  bodyRadius,
  cameraDistance,
  minLod = minTileLodForBodyRadius(),
  maxLod = maxTileLodForBodyRadius(bodyRadius),
}: {
  bodyRadius: number
  cameraDistance: number
  minLod?: number
  maxLod?: number
}): number {
  const altitude = Math.max(0, cameraDistance - bodyRadius)
  const altitudeRatio = altitude / Math.max(1, bodyRadius)
  const desired = altitudeRatio < 0.01
    ? maxLod
    : altitudeRatio < 0.05
      ? maxLod - 2
      : altitudeRatio < 0.2
        ? maxLod - 4
        : altitudeRatio < 1
          ? minLod + 2
          : minLod
  return Math.min(maxLod, Math.max(minLod, desired))
}
