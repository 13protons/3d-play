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

/**
 * Target sun-light intensity for the vehicle view: full sun in open space,
 * zero inside a body's shadow (the occlusion test is already computed by the
 * caller). The caller eases the light toward this target over a fraction of a
 * second so crossing the shadow boundary reads as a fast terminator sweep
 * rather than a single-frame pop.
 */
export function vehicleSceneSunLightIntensity(sunOccluded: boolean): number {
  return sunOccluded ? 0 : 2
}

/**
 * Perceptual sun-disc exaggeration that yields to eclipses. The vehicle view
 * draws the sun `maxScale`× its true angular size (cameras make it read far
 * smaller than the eye's impression) — but an eclipsing body's disc is drawn
 * at TRUE size, so a full exaggeration would leave a bright ring around a
 * body that geometrically covers the sun. As any occluder's disc approaches
 * the sun's, the scale eases back to 1 so totality plays out at honest scale.
 */
export function sunApparentScale(
  observerPosition: Vec3,
  sunPosition: Vec3,
  sunRadius: number,
  occluders: SunOccluder[],
  maxScale: number,
): number {
  const sx = sunPosition[0] - observerPosition[0]
  const sy = sunPosition[1] - observerPosition[1]
  const sz = sunPosition[2] - observerPosition[2]
  const sunDistance = Math.hypot(sx, sy, sz)
  if (sunDistance === 0) return maxScale
  const sunAngular = sunRadius / sunDistance

  let scale = maxScale
  for (const occluder of occluders) {
    const ox = occluder.position[0] - observerPosition[0]
    const oy = occluder.position[1] - observerPosition[1]
    const oz = occluder.position[2] - observerPosition[2]
    const occDistance = Math.hypot(ox, oy, oz)
    if (occDistance === 0 || occDistance >= sunDistance) continue
    const occAngular = occluder.radius / occDistance

    // Angular separation between the sun's and the occluder's centres.
    const cos = (sx * ox + sy * oy + sz * oz) / (sunDistance * occDistance)
    const separation = Math.acos(Math.min(1, Math.max(-1, cos)))

    // Discs touching at true scale → fully honest size; ease the exaggeration
    // back in as the occluder moves one exaggerated-sun-diameter away.
    const touch = occAngular + sunAngular
    const clear = occAngular + sunAngular * (2 * maxScale)
    const t = Math.min(1, Math.max(0, (separation - touch) / (clear - touch)))
    scale = Math.min(scale, 1 + (maxScale - 1) * t)
  }
  return scale
}
