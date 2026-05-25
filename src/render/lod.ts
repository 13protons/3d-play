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
  return bodySphereSegmentsForCameraDistance({
    distanceToCamera: distanceFromBodyCenter,
    bodyRadius,
  })
}

export function bodySphereSegmentsForCameraDistance({
  distanceToCamera,
  bodyRadius,
}: {
  distanceToCamera: number
  bodyRadius: number
}): number {
  const altitude = distanceToCamera - bodyRadius
  if (altitude < bodyRadius) return 512
  if (distanceToCamera < bodyRadius * 3) return 128
  return 32
}
