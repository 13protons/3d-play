export function projectedRadiusPx(
  radius: number,
  distance: number,
  pixelsPerRadian: number,
): number {
  if (distance <= 0) return Number.POSITIVE_INFINITY
  return (radius / distance) * pixelsPerRadian
}

export function shouldUseBodySprite(
  projectedRadius: number,
  meshThresholdPx: number,
): boolean {
  return projectedRadius < meshThresholdPx
}

export function shouldSuppressChildSprite(
  screenSeparationPx: number,
  collapseThresholdPx: number,
): boolean {
  return screenSeparationPx < collapseThresholdPx
}

export function spriteWorldSize(
  desiredSizePx: number,
  distance: number,
  pixelsPerRadian: number,
): number {
  return (desiredSizePx / pixelsPerRadian) * distance
}

export function sphereSegmentsForVehicleDistance(
  distanceFromBodyCenter: number,
  bodyRadius: number,
): number {
  return distanceFromBodyCenter < bodyRadius * 2 ? 128 : 32
}
