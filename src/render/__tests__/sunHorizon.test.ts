import { describe, expect, it } from 'vitest'
import {
  computeSunHorizon,
  limitingMagnitude,
  sampleTwilightColumn,
  twilightEndAltitude,
  twilightPhase,
  NAKED_EYE_LIMIT,
  SUN_ANGULAR_RADIUS,
} from '../sky/sunHorizon'

const center = { x: 0, y: 0, z: 0 }
const R = 100
const DEG = Math.PI / 180

describe('computeSunHorizon', () => {
  it('puts the sun at the zenith when it is straight up from a surface observer', () => {
    const observer = { x: 0, y: R, z: 0 }
    const sun = { x: 0, y: 1, z: 0 }
    const h = computeSunHorizon(observer, center, R, sun, 0)
    expect(h.altitudeAboveHorizontal).toBeCloseTo(Math.PI / 2, 6)
    expect(h.horizonDip).toBeCloseTo(0, 6)
    expect(h.occlusion).toBe(0)
  })

  it('reads zero altitude with no dip when the sun is on the local horizontal at the surface', () => {
    const observer = { x: 0, y: R, z: 0 }
    const sun = { x: 1, y: 0, z: 0 } // perpendicular to up
    const h = computeSunHorizon(observer, center, R, sun, 0)
    expect(h.altitudeAboveHorizontal).toBeCloseTo(0, 6)
    expect(h.altitude).toBeCloseTo(0, 6)
  })

  it('treats the sun as below the true horizon (occluded) when it dips under the surface', () => {
    const observer = { x: 0, y: R, z: 0 }
    const sun = { x: 0, y: -0.5, z: 0.866 } // ~30deg below horizontal
    const h = computeSunHorizon(observer, center, R, sun, 0)
    expect(h.altitude).toBeLessThan(0)
    expect(h.occlusion).toBe(1)
  })

  it('lifts the true horizon below local horizontal as the observer climbs', () => {
    const observer = { x: 0, y: R * 2, z: 0 } // r = 2R
    const sun = { x: 0, y: 0, z: 0 }
    const h = computeSunHorizon(observer, center, R, observer, 0)
    // dip = acos(R / 2R) = 60deg
    expect(h.horizonDip).toBeCloseTo(60 * DEG, 6)
    void sun
  })

  it('keeps a sun slightly below horizontal still visible once the observer is high enough', () => {
    const observer = { x: 0, y: R * 2, z: 0 } // dip = 60deg
    // sun 30deg below local horizontal: -30 + 60 dip = +30 above true horizon
    const sun = { x: Math.cos(-30 * DEG), y: Math.sin(-30 * DEG), z: 0 }
    const h = computeSunHorizon(observer, center, R, sun, 0)
    expect(h.altitudeAboveHorizontal).toBeCloseTo(-30 * DEG, 5)
    expect(h.altitude).toBeCloseTo(30 * DEG, 5)
    expect(h.occlusion).toBe(0)
  })

  it('crossfades occlusion across the sun disk near the horizon', () => {
    const observer = { x: 0, y: R, z: 0 }
    // Sun exactly on the horizon → half the disk occluded.
    const onHorizon = computeSunHorizon(observer, center, R, { x: 1, y: 0, z: 0 }, SUN_ANGULAR_RADIUS)
    expect(onHorizon.occlusion).toBeCloseTo(0.5, 6)
    // A hair above → less than half; a hair below → more than half.
    const above = computeSunHorizon(
      observer,
      center,
      R,
      { x: Math.cos(SUN_ANGULAR_RADIUS), y: Math.sin(SUN_ANGULAR_RADIUS), z: 0 },
      SUN_ANGULAR_RADIUS,
    )
    expect(above.occlusion).toBeLessThan(0.5)
  })
})

describe('sampleTwilightColumn', () => {
  const base = { planetCenter: center, planetRadius: R, atmosphereThickness: 5 }
  const observer = { x: 0, y: R, z: 0 } // surface observer, up = +Y

  it('fully lights the column with no reddening when the sun is overhead', () => {
    const c = sampleTwilightColumn({ ...base, observer, sunDirection: { x: 0, y: 1, z: 0 } })
    expect(c.litFraction).toBeCloseTo(1, 5)
    expect(c.shadowHeight).toBe(0)
    expect(c.airmass).toBeCloseTo(1, 5)
    expect(c.redness).toBeCloseTo(0, 5)
    expect(c.intensity).toBeGreaterThan(0.9)
  })

  it('drives litFraction to zero and the shadow to the top when the sun is well below', () => {
    const c = sampleTwilightColumn({ ...base, observer, sunDirection: { x: 0, y: -1, z: 0 } })
    expect(c.litFraction).toBeCloseTo(0, 5)
    expect(c.shadowHeight).toBeCloseTo(base.atmosphereThickness, 5)
    expect(c.intensity).toBeCloseTo(0, 5)
  })

  it('keeps the vertical column lit but reddened with a long path when the sun is on the horizon', () => {
    // s=0: the column straight up is still fully sunlit (shadow only climbs once the sun drops below).
    const c = sampleTwilightColumn({ ...base, observer, sunDirection: { x: 1, y: 0, z: 0 } })
    expect(c.litFraction).toBeCloseTo(1, 5)
    expect(c.shadowHeight).toBe(0)
    expect(c.airmass).toBeGreaterThan(1) // grazing path is far longer than vertical
    expect(c.redness).toBeGreaterThan(0.2)
  })

  it('partially shadows the column once the sun is below the horizon', () => {
    const c = sampleTwilightColumn({
      ...base,
      observer,
      sunDirection: { x: Math.cos(-8 * DEG), y: Math.sin(-8 * DEG), z: 0 },
    })
    expect(c.litFraction).toBeGreaterThan(0)
    expect(c.litFraction).toBeLessThan(1)
    expect(c.shadowHeight).toBeGreaterThan(0)
  })

  it('climbs the shadow up the column as the sun sinks further below the horizon', () => {
    const shallow = sampleTwilightColumn({
      ...base,
      observer,
      sunDirection: { x: Math.cos(-5 * DEG), y: Math.sin(-5 * DEG), z: 0 },
    })
    const deeper = sampleTwilightColumn({
      ...base,
      observer,
      sunDirection: { x: Math.cos(-12 * DEG), y: Math.sin(-12 * DEG), z: 0 },
    })
    expect(deeper.shadowHeight).toBeGreaterThan(shallow.shadowHeight)
    expect(deeper.litFraction).toBeLessThan(shallow.litFraction)
  })

  it('reports a full sky overhead and bright illumination on the daylit surface', () => {
    const c = sampleTwilightColumn({ ...base, observer, sunDirection: { x: 0, y: 1, z: 0 } })
    expect(c.airAbove).toBeCloseTo(1, 5)
    expect(c.skyIllumination).toBeGreaterThan(0.8)
  })

  it('drops sky illumination to ~0 above the atmosphere even with the sun up (so "up" is stars)', () => {
    const high = { x: 0, y: R + 2 * base.atmosphereThickness, z: 0 } // well above the shell
    const c = sampleTwilightColumn({ ...base, observer: high, sunDirection: { x: 0, y: 1, z: 0 } })
    expect(c.airAbove).toBeCloseTo(0, 5)
    expect(c.skyIllumination).toBeCloseTo(0, 5)
  })

  it('keeps a full sky overhead at night but with ~0 illumination', () => {
    const c = sampleTwilightColumn({ ...base, observer, sunDirection: { x: 0, y: -1, z: 0 } })
    expect(c.airAbove).toBeCloseTo(1, 5)
    expect(c.skyIllumination).toBeCloseTo(0, 5)
  })

  it('thins the sky monotonically as the observer climbs', () => {
    const sun = { x: 0, y: 1, z: 0 }
    const low = sampleTwilightColumn({ ...base, observer: { x: 0, y: R + 1, z: 0 }, sunDirection: sun })
    const mid = sampleTwilightColumn({ ...base, observer: { x: 0, y: R + 3, z: 0 }, sunDirection: sun })
    expect(mid.airAbove).toBeLessThan(low.airAbove)
    expect(mid.airAbove).toBeGreaterThan(0)
  })

  it('returns a per-slice profile only when asked, of the requested length', () => {
    const plain = sampleTwilightColumn({ ...base, observer, sunDirection: { x: 0, y: 1, z: 0 } })
    expect(plain.samples).toBeUndefined()
    const withSamples = sampleTwilightColumn({
      ...base,
      observer,
      sunDirection: { x: 0, y: 1, z: 0 },
      slices: 8,
      includeSamples: true,
    })
    expect(withSamples.samples).toHaveLength(8)
    // Density falls off with altitude.
    const s = withSamples.samples!
    expect(s[0].density).toBeGreaterThan(s[s.length - 1].density)
  })
})

describe('twilightEndAltitude', () => {
  const observer = { x: 0, y: R, z: 0 }

  it('matches the altitude where the shadow just fills the whole column', () => {
    const thickness = 5
    const end = twilightEndAltitude(R, thickness) // = -acos(R / (R+thickness))
    // A hair above the boundary still has some lit column; a hair below is fully dark.
    const above = sampleTwilightColumn({
      observer,
      planetCenter: center,
      planetRadius: R,
      atmosphereThickness: thickness,
      sunDirection: { x: Math.cos(end + 0.5 * DEG), y: Math.sin(end + 0.5 * DEG), z: 0 },
    })
    const below = sampleTwilightColumn({
      observer,
      planetCenter: center,
      planetRadius: R,
      atmosphereThickness: thickness,
      sunDirection: { x: Math.cos(end - 0.5 * DEG), y: Math.sin(end - 0.5 * DEG), z: 0 },
    })
    expect(above.litFraction).toBeGreaterThan(0)
    expect(below.litFraction).toBeCloseTo(0, 4)
  })

  it('lengthens twilight (more negative) for a thicker atmosphere', () => {
    expect(twilightEndAltitude(R, 10)).toBeLessThan(twilightEndAltitude(R, 2))
  })
})

describe('limitingMagnitude', () => {
  it('hits the standard twilight anchor magnitudes', () => {
    expect(limitingMagnitude(0)).toBeCloseTo(-4, 6)
    expect(limitingMagnitude(-6 * DEG)).toBeCloseTo(1, 6)
    expect(limitingMagnitude(-12 * DEG)).toBeCloseTo(4, 6)
    expect(limitingMagnitude(-18 * DEG)).toBeCloseTo(NAKED_EYE_LIMIT, 6)
  })

  it('caps at the naked-eye limit deep in the night', () => {
    expect(limitingMagnitude(-40 * DEG)).toBe(NAKED_EYE_LIMIT)
  })

  it('rises monotonically as the sun sinks (more stars become visible)', () => {
    expect(limitingMagnitude(-3 * DEG)).toBeGreaterThan(limitingMagnitude(0))
    expect(limitingMagnitude(-9 * DEG)).toBeGreaterThan(limitingMagnitude(-3 * DEG))
  })

  it('reveals the full sky regardless of sun altitude once above the atmosphere', () => {
    // Daytime altitude, but no air overhead → dark-sky limit.
    expect(limitingMagnitude(30 * DEG, 0)).toBeCloseTo(NAKED_EYE_LIMIT, 6)
    // Partway up, the limit sits between the daylit ground value and the dark-sky value.
    const mid = limitingMagnitude(30 * DEG, 0.5)
    expect(mid).toBeGreaterThan(-4)
    expect(mid).toBeLessThan(NAKED_EYE_LIMIT)
  })
})

describe('twilightPhase', () => {
  it('labels the standard solar-elevation bands', () => {
    expect(twilightPhase(10 * DEG)).toBe('day')
    expect(twilightPhase(3 * DEG)).toBe('golden')
    expect(twilightPhase(-3 * DEG)).toBe('civil')
    expect(twilightPhase(-9 * DEG)).toBe('nautical')
    expect(twilightPhase(-15 * DEG)).toBe('astronomical')
    expect(twilightPhase(-25 * DEG)).toBe('night')
  })
})
