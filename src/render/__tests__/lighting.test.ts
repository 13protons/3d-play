import { describe, expect, it } from 'vitest'
import {
  distantBodyApparentScale,
  isSunOccluded,
  projectDistantSphere,
  sunCoverageFraction,
  vehicleSceneSunLightIntensity,
  vehicleSceneSunLightPosition,
} from '../lighting'

describe('isSunOccluded', () => {
  it('returns true when a body intersects the vehicle-to-sun line segment', () => {
    const occluded = isSunOccluded(
      [0, 0, 0],
      [10, 0, 0],
      [{ id: 'earth', position: [5, 0, 0], radius: 1 }],
    )

    expect(occluded).toBe(true)
  })

  it('returns false when a body is near but clear of the vehicle-to-sun line', () => {
    const occluded = isSunOccluded(
      [0, 0, 0],
      [10, 0, 0],
      [{ id: 'earth', position: [5, 2, 0], radius: 1 }],
    )

    expect(occluded).toBe(false)
  })

  it('ignores bodies behind the vehicle or beyond the sun', () => {
    const occluded = isSunOccluded(
      [0, 0, 0],
      [10, 0, 0],
      [
        { id: 'behind', position: [-1, 0, 0], radius: 2 },
        { id: 'beyond', position: [12, 0, 0], radius: 2 },
      ],
    )

    expect(occluded).toBe(false)
  })
})

describe('projectDistantSphere', () => {
  it('projects a distant body to a fixed render distance', () => {
    const projected = projectDistantSphere([0, 0, 0], [1000, 0, 0], 10, 100)

    expect(projected.position).toEqual([100, 0, 0])
  })

  it('preserves angular radius at the projected distance', () => {
    const projected = projectDistantSphere([0, 0, 0], [1000, 0, 0], 10, 100)

    expect(projected.radius).toBeCloseTo(1)
  })
})

describe('vehicleSceneSunLightPosition', () => {
  it('uses the real observer-to-sun direction for vehicle scene lighting', () => {
    const position = vehicleSceneSunLightPosition(
      [10, 0, 0],
      [10, 100, 0],
      50,
    )

    expect(position).toEqual([0, 50, 0])
  })

  it('keeps global sunlight enabled even when the sun proxy is occluded from the vehicle', () => {
    const position = vehicleSceneSunLightPosition(
      [0, 0, 0],
      [100, 0, 0],
      50,
    )
    const proxyOccluded = isSunOccluded(
      [0, 0, 0],
      [100, 0, 0],
      [{ id: 'earth', position: [10, 0, 0], radius: 2 }],
    )

    expect(proxyOccluded).toBe(true)
    expect(position).toEqual([50, 0, 0])
    // Fully covered sun contributes nothing (only the ambient earthshine
    // stand-in lights the craft); partial coverage dims proportionally.
    expect(vehicleSceneSunLightIntensity(1)).toBe(0)
    expect(vehicleSceneSunLightIntensity(0)).toBe(2)
    expect(vehicleSceneSunLightIntensity(0.5)).toBe(1)
  })
})

describe('distantBodyApparentScale', () => {
  const MAX = 2.5

  it('keeps a body you are at (landed / low orbit) at true size', () => {
    // Earth from LEO: distance ≈ 1.05 radii.
    expect(distantBodyApparentScale(6.7e6, 6.371e6, MAX)).toBe(1)
  })

  it('fully exaggerates far bodies — and by the SAME factor for sun and moon', () => {
    // Moon from Earth (d/r ≈ 221) and Sun from Earth (d/r ≈ 215) both hit the
    // cap, so a body that geometrically covers the sun still covers it drawn.
    expect(distantBodyApparentScale(3.844e8, 1.737e6, MAX)).toBe(MAX)
    expect(distantBodyApparentScale(1.496e11, 6.96e8, MAX)).toBe(MAX)
  })

  it('ramps smoothly through the approach', () => {
    const mid = distantBodyApparentScale(30 * 1.737e6, 1.737e6, MAX)
    expect(mid).toBeGreaterThan(1)
    expect(mid).toBeLessThan(MAX)
  })

  it('is safe for degenerate radii', () => {
    expect(distantBodyApparentScale(1e9, 0, MAX)).toBe(1)
  })
})

describe('sunCoverageFraction', () => {
  // Sun ahead at 100 units with radius 1 → angular radius ~0.01 rad.
  const observer: [number, number, number] = [0, 0, 0]
  const sun: [number, number, number] = [100, 0, 0]
  const sunRadius = 1

  it('is 0 with no occluders or with one far off the sun line', () => {
    expect(sunCoverageFraction(observer, sun, sunRadius, [])).toBe(0)
    expect(
      sunCoverageFraction(observer, sun, sunRadius, [
        { id: 'moon', position: [0, 50, 0], radius: 1 },
      ]),
    ).toBe(0)
  })

  it('is 1 during totality (larger occluder centred on the sun)', () => {
    // Occluder at 10 units, radius 0.2 → angular 0.02, twice the sun's 0.01.
    expect(
      sunCoverageFraction(observer, sun, sunRadius, [
        { id: 'moon', position: [10, 0, 0], radius: 0.2 },
      ]),
    ).toBe(1)
  })

  it('caps annular coverage at the area ratio', () => {
    // Smaller occluder centred on the sun: angular 0.005 vs sun 0.01 → 25%.
    const coverage = sunCoverageFraction(observer, sun, sunRadius, [
      { id: 'moon', position: [10, 0, 0], radius: 0.05 },
    ])
    expect(coverage).toBeCloseTo(0.25, 5)
  })

  it('reports a partial fraction for offset discs', () => {
    // Equal angular sizes, centres one radius (0.01 rad) apart → ~39% overlap.
    const coverage = sunCoverageFraction(observer, sun, sunRadius, [
      { id: 'moon', position: [10, 0.1, 0], radius: 0.1 },
    ])
    expect(coverage).toBeGreaterThan(0.3)
    expect(coverage).toBeLessThan(0.5)
  })

  it('ignores occluders behind the sun', () => {
    expect(
      sunCoverageFraction(observer, sun, sunRadius, [
        { id: 'planet', position: [200, 0, 0], radius: 4 },
      ]),
    ).toBe(0)
  })
})
