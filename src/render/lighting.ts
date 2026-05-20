export type Vec3 = [number, number, number]

export interface SunOccluder {
  id: string
  position: Vec3
  radius: number
}

export function isSunOccluded(
  observerPosition: Vec3,
  sunPosition: Vec3,
  occluders: SunOccluder[],
): boolean {
  const sx = sunPosition[0] - observerPosition[0]
  const sy = sunPosition[1] - observerPosition[1]
  const sz = sunPosition[2] - observerPosition[2]
  const sunDistanceSq = sx * sx + sy * sy + sz * sz

  if (sunDistanceSq === 0) return false

  for (const occluder of occluders) {
    const ox = occluder.position[0] - observerPosition[0]
    const oy = occluder.position[1] - observerPosition[1]
    const oz = occluder.position[2] - observerPosition[2]

    const t = (ox * sx + oy * sy + oz * sz) / sunDistanceSq
    if (t <= 0 || t >= 1) continue

    const closestX = sx * t
    const closestY = sy * t
    const closestZ = sz * t
    const dx = ox - closestX
    const dy = oy - closestY
    const dz = oz - closestZ

    if (dx * dx + dy * dy + dz * dz <= occluder.radius * occluder.radius) {
      return true
    }
  }

  return false
}

export function projectDistantSphere(
  observerPosition: Vec3,
  bodyPosition: Vec3,
  bodyRadius: number,
  renderDistance: number,
): { position: Vec3; radius: number } {
  const dx = bodyPosition[0] - observerPosition[0]
  const dy = bodyPosition[1] - observerPosition[1]
  const dz = bodyPosition[2] - observerPosition[2]
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz)

  if (distance === 0) {
    return { position: [0, 0, 0], radius: bodyRadius }
  }

  const scale = renderDistance / distance
  return {
    position: [dx * scale, dy * scale, dz * scale],
    radius: bodyRadius * scale,
  }
}

export function directionalLightPosition(
  observerPosition: Vec3,
  lightPosition: Vec3,
  distance: number,
): Vec3 {
  const dx = lightPosition[0] - observerPosition[0]
  const dy = lightPosition[1] - observerPosition[1]
  const dz = lightPosition[2] - observerPosition[2]
  const magnitude = Math.hypot(dx, dy, dz)
  if (magnitude === 0) return [0, 0, 0]
  const scale = distance / magnitude
  return [dx * scale, dy * scale, dz * scale]
}

export function vehicleSceneSunLightPosition(
  observerPosition: Vec3,
  sunPosition: Vec3,
  distance: number,
): Vec3 {
  return directionalLightPosition(observerPosition, sunPosition, distance)
}

export function vehicleSceneSunLightIntensity(_sunProxyOccluded: boolean): number {
  return 2
}
