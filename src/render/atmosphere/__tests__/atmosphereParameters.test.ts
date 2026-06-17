import { describe, expect, it } from 'vitest'
import { AtmosphereParameters } from '@takram/three-atmosphere'
import { atmosphereParametersFromRenderConfig } from '../atmosphereParameters'
import type { AtmosphereRenderConfig } from '../../../state/trajectories'
import earthAtmosphere from '../../../../public/data/bodies/earth/atmosphere.json'

const EARTH_RENDER = earthAtmosphere.render as unknown as AtmosphereRenderConfig

describe('atmosphereParametersFromRenderConfig', () => {
  it("maps Earth's render asset onto takram's DEFAULT params (calibration)", () => {
    // DEFAULT uses bottomRadius 6_360_000; pass the same so topRadius lines up.
    const p = atmosphereParametersFromRenderConfig(EARTH_RENDER, 6_360_000)
    const d = AtmosphereParameters.DEFAULT

    expect(p.bottomRadius).toBe(6_360_000)
    expect(p.topRadius).toBe(6_420_000)
    expect(p.rayleighScattering.x).toBeCloseTo(d.rayleighScattering.x, 6)
    expect(p.rayleighScattering.y).toBeCloseTo(d.rayleighScattering.y, 6)
    expect(p.rayleighScattering.z).toBeCloseTo(d.rayleighScattering.z, 6)
    expect(p.rayleighDensity[1].expScale).toBeCloseTo(d.rayleighDensity[1].expScale, 6)
    expect(p.mieScattering.x).toBeCloseTo(d.mieScattering.x, 6)
    expect(p.mieExtinction.x).toBeCloseTo(d.mieExtinction.x, 6)
    expect(p.mieDensity[1].expScale).toBeCloseTo(d.mieDensity[1].expScale, 6)
    expect(p.miePhaseFunctionG).toBe(d.miePhaseFunctionG)
  })

  it('derives topRadius from the body radius + shellHeight (radius from the manifest)', () => {
    const p = atmosphereParametersFromRenderConfig(EARTH_RENDER, 6_371_000)
    expect(p.topRadius).toBe(6_371_000 + EARTH_RENDER.shellHeight)
  })

  it('builds a single exponential density layer with per-km expScale', () => {
    const config: AtmosphereRenderConfig = {
      shellHeight: 100_000,
      rayleighScattering: [1e-3, 2e-3, 3e-3],
      rayleighScaleHeight: 8000,
      mieScattering: 4e-3,
      mieScaleHeight: 1200,
      miePhaseFunctionG: 0.76,
    }
    const p = atmosphereParametersFromRenderConfig(config, 1_000_000)

    // First layer is the unused zero layer; second carries the exponential.
    expect(p.rayleighDensity[0].expTerm).toBe(0)
    expect(p.rayleighDensity[1].expTerm).toBe(1)
    expect(p.rayleighDensity[1].expScale).toBeCloseTo(-1 / 8, 6) // -1 / (8000 m / 1000)
    expect(p.mieDensity[1].expScale).toBeCloseTo(-1 / 1.2, 6) // -1 / (1200 m / 1000)
    // Mie extinction = scattering / single-scattering albedo (0.9).
    expect(p.mieExtinction.x).toBeCloseTo(4e-3 / 0.9, 9)
  })
})
