import { describe, expect, it } from 'vitest'
import {
  isSunOccluded,
  projectDistantSphere,
  sunApparentScale,
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
    // In the parent body's shadow the sun contributes nothing; only the
    // ambient term (earthshine stand-in) lights the craft.
    expect(vehicleSceneSunLightIntensity(proxyOccluded)).toBe(0)
    expect(vehicleSceneSunLightIntensity(false)).toBe(2)
  })
})

describe('sunApparentScale', () => {
  // Sun straight ahead at 100 units, radius 1 (angular radius ~0.01).
  const observer: [number, number, number] = [0, 0, 0]
  const sun: [number, number, number] = [100, 0, 0]
  const sunRadius = 1

  it('keeps the full exaggeration with no occluder nearby', () => {
    const scale = sunApparentScale(observer, sun, sunRadius, [], 2.5)
    expect(scale).toBe(2.5)
  })

  it('keeps the full exaggeration when an occluder is far from the sun line', () => {
    // Same angular size as the sun but 90° away in the sky.
    const scale = sunApparentScale(
      observer,
      sun,
      sunRadius,
      [{ id: 'moon', position: [0, 100, 0], radius: 1 }],
      2.5,
    )
    expect(scale).toBe(2.5)
  })

  it('drops to true size when an occluder is centred on the sun (totality)', () => {
    // Moon dead ahead at 10 units, angular radius 0.02 — covers the sun's 0.01.
    const scale = sunApparentScale(
      observer,
      sun,
      sunRadius,
      [{ id: 'moon', position: [10, 0, 0], radius: 0.2 }],
      2.5,
    )
    expect(scale).toBe(1)
  })

  it('transitions smoothly through a partial eclipse approach', () => {
    // Occluder offset so its disc is near, but not overlapping, the sun's.
    const scale = sunApparentScale(
      observer,
      sun,
      sunRadius,
      [{ id: 'moon', position: [10, 0.45, 0], radius: 0.2 }],
      2.5,
    )
    expect(scale).toBeGreaterThan(1)
    expect(scale).toBeLessThan(2.5)
  })
})
