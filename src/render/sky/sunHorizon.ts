/**
 * Cheap, exact geometry for "where is the sun relative to the observer's horizon?".
 *
 * The expensive part of an atmosphere is twilight, and twilight is almost entirely a
 * function of one scalar: how many degrees the sun sits above (or below) the observer's
 * true horizon. The dramatic sunrise/sunset palette is just that angle sweeping through
 * a narrow band around zero. So before any shading we compute that angle — plus how much
 * of the sun's disk the planet's limb is eating — as a couple of trig ops per observer.
 *
 * Everything is a pure function of world-space vectors; no allocations, no three deps
 * beyond reading three numbers off whatever vector-like you pass in. Sign convention:
 * positive altitude = above the horizon, negative = below.
 */

export interface Vec3Like {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface SunHorizon {
  /** asin(up·sunDir): sun altitude above the *local horizontal* plane, radians. */
  altitudeAboveHorizontal: number
  /** How far the true (geometric) horizon dips below horizontal from the observer's
   * elevation, radians, >= 0. Zero at the surface, grows as you climb. */
  horizonDip: number
  /** Sun altitude above the *true* (limb) horizon, radians.
   * = altitudeAboveHorizontal + horizonDip. This is the number twilight tracks. */
  altitude: number
  /** Sun-disk occlusion by the planet limb: 0 = fully visible, 1 = fully hidden.
   * Soft across the disk when a non-zero angular radius is supplied. */
  occlusion: number
}

/** Mean solar angular radius seen from Earth, radians (~0.266°). Reasonable default. */
export const SUN_ANGULAR_RADIUS = 0.00465

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/**
 * @param observer       observer/camera world position
 * @param planetCenter   planet center world position
 * @param planetRadius   planet radius (same units as positions)
 * @param sunDirection   *unit* vector from the observer toward the sun (parallel-ray
 *                       approximation is fine — the sun is effectively at infinity)
 * @param sunAngularRadius half-angle of the sun's disk, radians; 0 gives a hard cutoff
 */
export function computeSunHorizon(
  observer: Vec3Like,
  planetCenter: Vec3Like,
  planetRadius: number,
  sunDirection: Vec3Like,
  sunAngularRadius = SUN_ANGULAR_RADIUS,
): SunHorizon {
  // Local up = radial direction from planet center to observer.
  let ux = observer.x - planetCenter.x
  let uy = observer.y - planetCenter.y
  let uz = observer.z - planetCenter.z
  const observerRadius = Math.hypot(ux, uy, uz) || 1
  ux /= observerRadius
  uy /= observerRadius
  uz /= observerRadius

  const upDotSun = clamp(ux * sunDirection.x + uy * sunDirection.y + uz * sunDirection.z, -1, 1)
  const altitudeAboveHorizontal = Math.asin(upDotSun)

  // Horizon dip: line of sight to the limb is tangent to the sphere, so it sits
  // acos(R / r) below local horizontal. Clamp r >= R for observers grazing/under the surface.
  const horizonDip = Math.acos(clamp(planetRadius / Math.max(observerRadius, planetRadius), -1, 1))

  const altitude = altitudeAboveHorizontal + horizonDip

  // Linear crossfade across the disk diameter: visible above +radius, hidden below -radius.
  const occlusion = sunAngularRadius > 0 ? clamp((sunAngularRadius - altitude) / (2 * sunAngularRadius), 0, 1) : altitude < 0 ? 1 : 0

  return { altitudeAboveHorizontal, horizonDip, altitude, occlusion }
}

/**
 * Coarse label for the sun's altitude, using the standard solar-elevation bands. Handy
 * for deciding *whether* to spend anything on atmosphere this frame, and for debug HUDs.
 * Thresholds in degrees: day > 0, then the three twilights, then night below -18.
 */
export type TwilightPhase = 'day' | 'golden' | 'civil' | 'nautical' | 'astronomical' | 'night'

const DEG = Math.PI / 180

export function twilightPhase(altitude: number): TwilightPhase {
  const deg = altitude / DEG
  if (deg > 6) return 'day'
  if (deg > 0) return 'golden'
  if (deg > -6) return 'civil'
  if (deg > -12) return 'nautical'
  if (deg > -18) return 'astronomical'
  return 'night'
}

/** Faintest magnitude the unaided human eye resolves under a pristine dark sky. */
export const NAKED_EYE_LIMIT = 6.5

/**
 * Approximate naked-eye limiting magnitude (faintest visible star) as a function of the
 * sun's altitude above the true horizon — i.e. how deep into the dark a star has to be to
 * shine through. Anchored to the standard twilight definitions, with the widely-cited
 * approximate limits at each boundary (magnitudes are "smaller = brighter"; Sun ≈ −26.7,
 * Vega ≈ 0, Sirius ≈ −1.5, naked-eye limit ≈ 6.5):
 *
 *    0° sunset        → ~ −4   (only the Moon / Venus / Jupiter)
 *   −6° civil dusk    → ~ +1   (the brightest stars and planets emerge)
 *  −12° nautical dusk → ~ +4
 *  −18° astro. dusk   → ~ +6.5 (full naked-eye sky)
 *
 * `airAbove` (from sampleTwilightColumn) lifts the limit toward the dark-sky value as the
 * observer climbs out of the atmosphere: with no air overhead the sky is black and the
 * full starfield shows even with the sun up.
 */
export function limitingMagnitude(sunAltitude: number, airAbove = 1): number {
  const deg = sunAltitude / DEG
  let ground: number
  if (deg >= 0) ground = -4
  else if (deg >= -6) ground = -4 + (5 / 6) * -deg // 0°→−4, −6°→+1
  else if (deg >= -12) ground = 1 + 0.5 * (-deg - 6) // −6°→+1, −12°→+4
  else if (deg >= -18) ground = 4 + (2.5 / 6) * (-deg - 12) // −12°→+4, −18°→+6.5
  else ground = NAKED_EYE_LIMIT
  return ground + (NAKED_EYE_LIMIT - ground) * (1 - clamp(airAbove, 0, 1))
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * The single-scattering "column" model (Alan's drawings #1–4): march a radial column of
 * air over the observer in `slices` steps and, at each layer, ask two cheap questions —
 * how dense is the air here, and is this layer still in sunlight or has the planet's
 * shadow swept up over it? The sun is at infinity so its "cone" is parallel rays; a layer
 * at radius r is lit iff its perpendicular distance from the planet's shadow axis
 * (r·cos(altitude)) clears the planet radius. That shadow line climbing the column is the
 * twilight mechanism (the rising Earth-shadow / Belt of Venus).
 *
 * Returns a compact descriptor the renderer can act on, all from ~`slices` iterations and
 * a closed-form slant airmass — no shader, no allocation on the default path.
 */
export interface TwilightSlice {
  /** Altitude of this layer above the surface, same units as radii. */
  altitude: number
  /** Relative air density here (exponential falloff), 0..1. */
  density: number
  /** How lit this layer is by the sun, 0 (in shadow) .. 1 (full sun); soft at the terminator. */
  lit: number
}

export interface TwilightColumnParams {
  observer: Vec3Like
  planetCenter: Vec3Like
  planetRadius: number
  /** Atmosphere shell thickness above the surface (R_atmo − R). */
  atmosphereThickness: number
  /** Unit vector from the observer toward the sun. */
  sunDirection: Vec3Like
  /** Column samples; more = smoother shadow line. Default 10. */
  slices?: number
  /** Density e-folding height; default thickness/4. */
  scaleHeight?: number
  /** Reddening per unit extra airmass (blue-minus-red optical depth). Default 0.15. */
  redCoefficient?: number
  /** Beam dimming per unit airmass (luminance extinction). Default 0.05. */
  beamCoefficient?: number
  /** When true, also return the per-slice profile (allocates). For debug/visualization. */
  includeSamples?: boolean
}

export interface TwilightColumn {
  /** Density-weighted fraction of the column in sunlight: 1 = full day, 0 = fully shadowed. */
  litFraction: number
  /** Scattered-light hint: litFraction attenuated by the sun beam's slant path. ~1 midday, →0 at night. */
  intensity: number
  /** How reddened the incoming sunlight is from its slant path: ~0 with a high sun, →1 near/below the horizon. */
  redness: number
  /** Altitude (above surface) where the planet shadow crosses the column: 0 fully lit, clamps to thickness when fully shadowed. */
  shadowHeight: number
  /** Slant airmass of the sun beam relative to vertical (1 = straight up). */
  airmass: number
  /** Fraction of the ground atmospheric column still above the observer: 1 at the surface,
   * 0 at/above the shell top. Pure altitude function — how much sky there is to wash out stars. */
  airAbove: number
  /** Overall sky illumination at the observer (zenith brightness): airAbove × intensity.
   * → 0 above the atmosphere (so "up" reads as stars) and at night; high in daylight near the surface. */
  skyIllumination: number
  /** Per-slice profile when `includeSamples` is set. */
  samples?: TwilightSlice[]
}

export function sampleTwilightColumn(params: TwilightColumnParams): TwilightColumn {
  const { observer, planetCenter, sunDirection } = params
  const R = params.planetRadius
  const T = params.atmosphereThickness
  const Ra = R + T
  const scaleHeight = params.scaleHeight ?? T / 4
  const redCoefficient = params.redCoefficient ?? 0.15
  const beamCoefficient = params.beamCoefficient ?? 0.05

  const dx = observer.x - planetCenter.x
  const dy = observer.y - planetCenter.y
  const dz = observer.z - planetCenter.z
  const rObs = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
  const inv = 1 / rObs

  // s = up·sun = sin(altitude above local horizontal). cosAlt is the lever for the shadow test.
  const s = clamp((dx * sunDirection.x + dy * sunDirection.y + dz * sunDirection.z) * inv, -1, 1)
  const cosAlt = Math.sqrt(Math.max(0, 1 - s * s))

  const r0 = Math.min(Math.max(rObs, R), Ra)
  const invH = 1 / scaleHeight

  // Shadow crossing: r·cosAlt = R → r = R/cosAlt (anti-sun side only). The shadow climbs as
  // the sun sinks; below twilightEndAltitude it passes the shell top and the column is dark.
  const shadowHeight = s >= 0 ? 0 : cosAlt > 1e-4 ? clamp(R / cosAlt - R, 0, T) : T
  const rShadow = s >= 0 ? r0 : cosAlt > 1e-4 ? R / cosAlt : Infinity
  const rLit = clamp(rShadow, r0, Ra)

  // litFraction is the density-weighted fraction of the column in sunlight. Density is
  // exp(-h/H), whose integral is closed-form — so we evaluate the lit interval [rLit, Ra]
  // over the whole column [r0, Ra] exactly, no marching. g(r) = exp(-(r-R)/H).
  const gR0 = Math.exp(-(r0 - R) * invH)
  const gRa = Math.exp(-(Ra - R) * invH)
  const gLit = rLit <= r0 ? gR0 : rLit >= Ra ? gRa : Math.exp(-(rLit - R) * invH)
  const denom = gR0 - gRa
  const litFraction = denom > 1e-9 ? clamp((gLit - gRa) / denom, 0, 1) : s >= 0 ? 1 : 0

  // Closed-form slant airmass: geometric path length to the shell, relative to the vertical (= T).
  const disc = Ra * Ra - rObs * rObs * (1 - s * s)
  const pathLength = disc > 0 ? -rObs * s + Math.sqrt(disc) : 0
  const airmass = clamp(pathLength / T, 1, 40)

  const redness = 1 - Math.exp(-redCoefficient * (airmass - 1))
  const intensity = litFraction * Math.exp(-beamCoefficient * airmass)

  // How much of the atmosphere is still above the observer (reuses gR0/gRa, no new exp):
  // air mass above altitude h ∝ exp(-h/H), normalized so surface = 1, shell top = 0.
  const denomAbove = 1 - gRa
  const airAbove = denomAbove > 1e-9 ? clamp((gR0 - gRa) / denomAbove, 0, 1) : clamp(1 - (r0 - R) / T, 0, 1)
  const skyIllumination = airAbove * intensity

  // The per-slice profile is for visualization/debug only; the scalars above don't need it.
  let samples: TwilightSlice[] | undefined
  if (params.includeSamples) {
    const slices = params.slices ?? 10
    const dr = (Ra - r0) / slices
    const penumbra = Math.max(R * SUN_ANGULAR_RADIUS, T * 0.02)
    samples = []
    for (let i = 0; i < slices; i++) {
      const r = r0 + (i + 0.5) * dr
      const altitude = r - R
      const density = Math.exp(-altitude * invH)
      const lit = r * s >= 0 ? 1 : smoothstep(R - penumbra, R + penumbra, r * cosAlt)
      samples.push({ altitude, density, lit })
    }
  }

  return { litFraction, intensity, redness, shadowHeight, airmass, airAbove, skyIllumination, samples }
}

/**
 * The sun altitude (negative, radians) at which the planet's shadow has just climbed past
 * the *entire* atmosphere column over the observer — dawn begins / dusk ends (Alan's
 * drawing #5: the grazing ray to the top of the column runs tangent to the planet, i.e.
 * perpendicular to its surface at the limb). Equals `-acos(R / (R + thickness))`. It
 * widens (more negative) with a thicker atmosphere, exactly as real twilight lasts longer
 * where the air is deeper. Below this altitude `sampleTwilightColumn` reads fully dark.
 */
export function twilightEndAltitude(planetRadius: number, atmosphereThickness: number): number {
  return -Math.acos(clamp(planetRadius / (planetRadius + atmosphereThickness), -1, 1))
}
