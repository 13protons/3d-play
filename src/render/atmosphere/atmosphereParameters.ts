import { Vector3 } from 'three'
import { AtmosphereParameters, DensityProfileLayer } from '@takram/three-atmosphere'
import type { AtmosphereRenderConfig } from '../../state/trajectories'

/**
 * Map a body's `atmosphere.json` `render` section onto takram's
 * `AtmosphereParameters`. The section is already authored in takram's own units
 * (per-km scattering coefficients, metre scale heights), so this is a near-direct
 * serialization — see docs/atmosphere-pipeline-refactor-plan-2026-06-17.md (D3).
 *
 * Conventions, verified against `AtmosphereParameters.DEFAULT`:
 *  - radii (`bottomRadius`/`topRadius`) are in metres; `bottomRadius` comes from
 *    the manifest's `physics.radius`, not the asset.
 *  - a single exponential density profile is `[zero-layer, exp-layer]` where the
 *    exp layer's `expScale` is per-km: `-1 / (scaleHeight_m / 1000)`.
 *  - Mie extinction = Mie scattering / single-scattering albedo (0.9 for Earth-like
 *    haze; matches DEFAULT's 0.003996 → 0.00444).
 *
 * Unset params (solarIrradiance, sunAngularRadius, ozone, etc.) fall back to
 * takram's DEFAULT, which is sun/Earth-correct for our single-sun sim.
 */
const MIE_SINGLE_SCATTERING_ALBEDO = 0.9

/** Bruneton single-exponential density profile exp(-h / scaleHeight). */
function exponentialProfile(
  scaleHeightMeters: number,
): [DensityProfileLayer, DensityProfileLayer] {
  const scaleHeightKm = scaleHeightMeters / 1000
  return [
    new DensityProfileLayer(0, 0, 0, 0, 0),
    new DensityProfileLayer(0, 1, -1 / scaleHeightKm, 0, 0),
  ]
}

export function atmosphereParametersFromRenderConfig(
  config: AtmosphereRenderConfig,
  bottomRadius: number,
): AtmosphereParameters {
  const mieScattering = new Vector3(
    config.mieScattering,
    config.mieScattering,
    config.mieScattering,
  )
  return new AtmosphereParameters({
    bottomRadius,
    topRadius: bottomRadius + config.shellHeight,
    rayleighScattering: new Vector3(...config.rayleighScattering),
    rayleighDensity: exponentialProfile(config.rayleighScaleHeight),
    mieScattering,
    mieExtinction: mieScattering.clone().divideScalar(MIE_SINGLE_SCATTERING_ALBEDO),
    mieDensity: exponentialProfile(config.mieScaleHeight),
    miePhaseFunctionG: config.miePhaseFunctionG,
  })
}
