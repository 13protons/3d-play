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
 * Target sun-light intensity for the vehicle view, scaled by how much of the
 * sun's disc is covered (sunCoverageFraction): full sun in open space, dimmed
 * through partial eclipse phases, zero at totality / inside a body's shadow.
 * The caller eases the light toward this target over a fraction of a second
 * so shadow crossings sweep rather than pop.
 */
export function vehicleSceneSunLightIntensity(sunCoverage: number): number {
  return 2 * (1 - Math.min(1, Math.max(0, sunCoverage)))
}

/**
 * Fraction of the sun's disc covered by the best-placed occluder, using TRUE
 * angular sizes (independent of any drawn exaggeration). Standard circle-
 * overlap area: 0 when the discs are clear of each other, the lens-area
 * fraction through partial phases, capped at the area ratio for an annular
 * pass and at 1 for totality. Drives eclipse dimming — sunlight scales with
 * the uncovered photosphere, so totality actually goes dark.
 */
export function sunCoverageFraction(
  observerPosition: Vec3,
  sunPosition: Vec3,
  sunRadius: number,
  occluders: SunOccluder[],
): number {
  const sx = sunPosition[0] - observerPosition[0]
  const sy = sunPosition[1] - observerPosition[1]
  const sz = sunPosition[2] - observerPosition[2]
  const sunDistance = Math.hypot(sx, sy, sz)
  if (sunDistance === 0) return 0
  const R = sunRadius / sunDistance // sun angular radius

  let best = 0
  for (const occluder of occluders) {
    const ox = occluder.position[0] - observerPosition[0]
    const oy = occluder.position[1] - observerPosition[1]
    const oz = occluder.position[2] - observerPosition[2]
    const occDistance = Math.hypot(ox, oy, oz)
    if (occDistance === 0 || occDistance >= sunDistance) continue
    const r = occluder.radius / occDistance // occluder angular radius

    const cos = (sx * ox + sy * oy + sz * oz) / (sunDistance * occDistance)
    const d = Math.acos(Math.min(1, Math.max(-1, cos))) // angular separation

    let coverage = 0
    if (d >= R + r) {
      coverage = 0
    } else if (d <= Math.abs(r - R)) {
      // Concentric-enough: full cover (total) or the area ratio (annular).
      coverage = r >= R ? 1 : (r * r) / (R * R)
    } else {
      // Lens area of two overlapping discs.
      const lens =
        R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R)) +
        r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r)) -
        0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R))
      coverage = lens / (Math.PI * R * R)
    }
    best = Math.max(best, Math.min(1, coverage))
  }
  return best
}

// distantBodyApparentScale ramp, in distance/radius: at NEAR the body is
// clearly "where you are" and draws true; by FAR it's celestial scenery and
// gets the full perceptual exaggeration.
const APPARENT_SCALE_NEAR_RATIO = 10
const APPARENT_SCALE_FAR_RATIO = 50

/**
 * Perceptual size exaggeration for distant bodies in the vehicle view. At a
 * 50° fov the sun's (or moon's) true half-degree disc is ~a dozen pixels —
 * optically correct but far smaller than the eye's impression (why sunsets
 * and moonrises disappoint in photos); games conventionally draw them 2–4×.
 *
 * Applying ONE distance-ramped factor to every body keeps eclipses honest for
 * free: whenever an occluder's disc is comparable to the sun's, both bodies
 * are deep in the "far" regime and inflate by the same factor, so a body that
 * geometrically covers the sun still covers it on screen. Bodies you are
 * landed on or orbiting stay true-size.
 */
export function distantBodyApparentScale(
  distance: number,
  radius: number,
  maxScale: number,
): number {
  if (radius <= 0) return 1
  const ratio = distance / radius
  const t = Math.min(
    1,
    Math.max(0, (ratio - APPARENT_SCALE_NEAR_RATIO) / (APPARENT_SCALE_FAR_RATIO - APPARENT_SCALE_NEAR_RATIO)),
  )
  return 1 + (maxScale - 1) * t
}
