# Atmosphere pipeline refactor — implementation plan (2026-06-17)

Plan to adopt `@takram/three-atmosphere` on the pmndrs `postprocessing` pipeline in
the **vehicle view**, replacing the v1 single-scattering shell. Greenlit by the spike
(see `docs/atmosphere-rendering-research-2026-06-17.md` → "spiked, and it did not
bite"). This is the design to review before writing the migration.

## Goals / non-goals

**Goals**
- Replace the v1 `AtmosphereShell` with takram's `Sky` + `AerialPerspectiveEffect`,
  composited through a real `EffectComposer`, in `VehicleScene`.
- Drive each body's atmosphere from its `atmosphere.json` plugin asset
  (`AtmosphereParameters` + runtime-baked, per-body-cached LUTs).
- Keep the working flight scene correct: the vehicle and local terrain stay crisp;
  distant celestial bodies, stars, and the sun keep rendering.
- Lay the foundation for bloom (Priority 2) on the same composer.

**Non-goals (separate follow-ups)**
- Orbital-view atmosphere (the other canvas) — its own integration later.
- Clouds, god rays, color grading, ACES pass — future composer effects.
- Terrain detail / surface meshing changes — unrelated front.

## What changes vs. today

Today `VehicleSceneRenderPasses` hand-rolls a multi-pass loop in `useFrame` (priority
1), with `gl={{ autoClear: false }}`:

```
gl.clear()
for pass in [base-body, terrain-overlay, atmosphere(v1 shell), vehicle]:
  if pass.clearDepthBefore: gl.clearDepth()   // only before `vehicle`
  camera.layers.set(pass.layer); gl.render(scene, camera)
```

The depth clear before `vehicle` exists to stop the 6,371 km planet and the ~10 m
multi-part rocket from sharing one depth buffer. `EffectComposer` wants to own the
render loop and read **one coherent depth buffer**, so the manual loop and the clear
are what we reconcile.

## Target architecture

One `EffectComposer` owns the vehicle canvas. The scene renders to a target with a
coherent depth buffer; the atmosphere is a screen-space effect that reads it.

```
<EffectComposer>                              // owns render-to-target + depth
  scene render (atmospheric near-field layer) // parent terrain/body + vehicle, one depth buffer
  <AerialPerspective ... />                    // scene × transmittance + inscatter, by depth
  // (later) <Bloom/>, tone-map, etc.
</EffectComposer>
<Sky/>                                         // or AerialPerspective sky:true — background sky
```

The **key split** is no longer "planet vs vehicle" but **"atmospheric near-field vs
deep space"**:

- **Near-field (fogged, coherent depth):** the parent body's local surface — the
  tiled terrain (`PlanetTerrainTiles`) and/or the body sphere when far — plus the
  vehicle. These share one depth buffer and are composited by `AerialPerspective`.
  The spike proved cm-scale parts and a 6,360 km surface coexist here without
  precision z-fighting at `near:0.1 far:1e9`.
- **Celestial bodies stay ours.** takram knows only a generic `sunDirection` + one
  generic `moonDirection` — it has no concept of our solar system, so it cannot render
  the sim's sun/moon/planets (and its sun/moon would be un-positioned, un-textured, and
  not eclipse-aware). All bodies remain our sim-driven, textured, occlusion-aware
  geometry, rendered into the coherent buffer as today, and are correctly fogged by the
  `topRadius`-bounded integral — no exclusion pass needed (see D2 / Q1).

## Key design decisions

### D0 — `atmosphere.json` is the body's single atmosphere asset (render + physics)
A body has two atmosphere facets, **consolidated** into one network-loaded plugin
asset with two sections:

```jsonc
{
  "render":  { "shellHeight": 100000, "rayleighScattering": [...], "rayleighScaleHeight": 8000,
               "mieScattering": ..., "mieScaleHeight": 1200, "miePhaseFunctionG": 0.76 },
  "physics": { "model": "exponential", "surfaceDensity": 1.225, "scaleHeight": 8500,
               "maxAltitude": 120000, "loadRadiusMultiplier": 1.25 }
}
```

- `render` — takram scattering params (D3); the takram coupling is quarantined here.
- `physics` — the exponential drag model that feeds aero / orbital decay
  (`aero.ts` / `dynamics.ts` / vehicle `worker.ts`). Renderer-agnostic SI, fed to the
  drag model directly — no converter.

This **moves the `physics` block out of `manifest.json`** (where it lives inline today)
into `atmosphere.json`. The manifest just links the asset; the bridge loads it and
distributes `physics` → sim and `render` → takram. Because the drag model is
sim-critical, a body that declares an `atmosphere.json` whose load fails is a **hard
error**, not a silent no-atmosphere fallback. `scenarioValidation` validates both
sections in the asset. The body radius is **not** duplicated — `bottomRadius` comes
from `manifest.physics.radius` (single source of truth).

### D1 — Depth buffer
Use one coherent depth buffer (drop the inter-pass `clearDepth`). The spike showed a
standard buffer is sufficient at `near:0.1 far:1e9` for the near field. Keep
`logarithmicDepthBuffer` in reserve (spike confirmed it doesn't break takram's depth
reconstruction) — only adopt it if a real vehicle exposes sub-mm part precision
issues the standard buffer can't hold. Prefer instead a **sane far plane for the
fogged pass** (and let takram own sun/moon/stars, D2).

### D2 — Bodies vs. takram's sky
**takram owns the sky scattering + aerial perspective only; we own every celestial
body.** takram's sky model knows a single generic `sunDirection` and one generic
`moonDirection` — it has no API for arbitrary solar-system bodies, and its sun/moon
would not be sim-positioned, textured, or eclipse-aware. So all bodies (sun, moon,
planets) stay our geometry, sim-driven and occlusion-aware, rendered into the coherent
buffer as today. We feed takram our `sunDirection` (and optionally `moonDirection` for
night) for the scattering, and **disable takram's sun/moon disks** (`sun:false,
moon:false`) — the bright circumsolar *glow* is still rendered (it's inscatter,
independent of the disk), so no second sun.

takram's aerial perspective integrates scattering only between the camera and where
the view ray exits `topRadius`, so our body disks (the sun drawn at a fake ~5e8 m,
distant planets) are fogged by *only the real atmosphere along the ray* — physically
correct: our sun reddens/dims near the horizon for free, untouched from orbit. **No
fog-exclusion pass needed.** Add one only if validation (`sun-earth-moon`
Moon-from-surface, `inner-solar-system`) shows a body looks wrong. Stars: keep drei's
for now; takram's twilight-fading stars are a later nicety, not a body.

### D3 — The `render` section → `AtmosphereParameters` map
The `render` section is a **direct serialization of takram's params** (Q2 resolved:
option A — takram's own units, no converter), so the map is field-for-field:

| atmosphere.json `render` | AtmosphereParameters | notes |
|---|---|---|
| (manifest `physics.radius`) | `bottomRadius` | from the manifest, not duplicated in the asset |
| `shellHeight` | `topRadius = radius + shellHeight` | |
| `rayleighScattering` (per-km) | `rayleighScattering` (Vector3) | takram units — **no conversion** |
| `rayleighScaleHeight` | `rayleighDensity` profile (exp) | build `DensityProfileLayer` |
| `mieScattering` | `mieScattering` / `mieExtinction` | |
| `mieScaleHeight` | `mieDensity` profile (exp) | |
| `miePhaseFunctionG` | `miePhaseFunctionG` | anisotropy |
| (optional) `solarIrradiance`, `groundAlbedo` | same | fall back to takram `DEFAULT` if absent |

Earth's `render` section = takram `DEFAULT`'s values (with `topRadius` from our
`shellHeight`). The `physics` section is unrelated to this map — it feeds the drag
model directly (D0).

### D4 — LUT generation & caching
Bake LUTs at runtime with `PrecomputedTexturesGenerator(gl).update(params)` (spike
proved this needs no external assets). The bake is ~one-time and not free, so **cache
the resulting `PrecomputedTextures` per body id** (keyed by body + a hash of its
params). Only the scenario's referenced bodies with an `atmosphereRender` config bake.
Guard `EXT_color_buffer_float`.

### D5 — Placement (`worldToECEFMatrix`)
The parent body sits at a floating-origin scene position each frame
(`bodyPos - vehiclePos`). Set the Atmosphere context's `worldToECEFMatrix` so scene
space maps to the body-centred ECEF frame takram expects: translation by the
body→camera offset, plus the body's surface-orientation rotation (reuse
`bodySurfaceOrientationEuler` / the existing rotation math). Set `sunDirection` from
the emissive body each frame (reuse `VehicleSunLight`'s sun-position logic). Use a
spherical `Ellipsoid(R,R,R)` per body (our bodies are spheres).

### D6 — Lighting (decision A: keep our lights)
**Keep the existing `VehicleSunLight` + ambient for all bodies; do NOT swap to
takram's `SunLight`/`SkyLight`.** takram's lights require the `<Atmosphere>`
context, which only exists for bodies *with* an atmosphere — a swap would leave
airless bodies (Moon, Mercury) unlit. Our directional sun already lights every
body and handles eclipses (`isSunOccluded`); the atmosphere look comes from
takram's sky + aerial-perspective fog (D2, phase 5). takram's `SunLight`/`SkyLight`
(physically-reddened sun, bluish sky ambient) remain an optional later refinement
for atmosphere bodies only, if our lighting looks flat once the sky is in.

## Implementation phases

1. **Data-layer consolidation + v1 teardown** (D0). Restructure `atmosphere.json` into
   `render` (takram-native, D3) + `physics` sections; move the `physics` block out of
   each `manifest.json` into its asset; update the bridge (load + distribute, hard-error
   on declared-but-failed asset), `BodyMeta`/types, and `scenarioValidation` (validate
   both sections in the asset). Delete the v1 `AtmosphereShell.tsx`, `atmosphereScatter.ts`,
   and the `atmosphere` render layer/pass; update `renderLayers` + its test. *Rationale:
   the `render` section becomes takram-native, which the v1 shell can't read — so v1 comes
   out now. Atmosphere visuals are intentionally absent until phase 5.* Green gates.
2. **Composer skeleton.** Stand up `EffectComposer` in `VehicleScene`, render the
   existing layers into it as one coherent pass (drop the depth clear), no atmosphere
   yet. Verify the vehicle + terrain + distant bodies still look right and `activeView`
   gating still works. *Checkpoint: parity with today, minus atmosphere.*
3. **`render` → `AtmosphereParameters` mapper** + per-body LUT cache (D3, D4).
   Unit-tested pure mapping function; calibrate Earth against `AtmosphereParameters.DEFAULT`.
4. **Place + LUTs** (done). Per-body LUT cache + `<Atmosphere>` provider +
   `worldToECEFMatrix`/`sunDirection` driver (D4, D5). Lighting unchanged — keep our
   eclipse-aware directional + ambient (D6, decision A).
5. **Atmosphere on.** Add `Sky` + `AerialPerspective` driven by our `sunDirection`,
   with takram's sun/moon disks **off** (`sun:false, moon:false`); keep all our body
   rendering. Confirm aerial perspective over terrain + vehicle and the sky/horizon,
   and that the `topRadius`-bounded fog reddens our sun at the horizon (Q1). Tune
   exposure/tone-map.
6. **Validate distant bodies / multi-body** (D2): Moon-from-Earth, `inner-solar-system`,
   eclipse gating still correct. Add a fog-exclusion overlay pass only if something
   looks wrong.
7. **Spike teardown.** Remove `/_spike/atmosphere` + its menu link once the real path
   lands (or keep as a dev sandbox — decide at the end).

## Open questions to resolve during implementation

- **Q1 (distant bodies) — Does takram's `topRadius`-bounded integration already fog
  distant bodies correctly, so no fog-exclusion pass is needed (per D2)?** Expected
  yes (the integral stops at the atmosphere shell); confirm in code during phase 4
  before relying on it, and that dropping our sun-disk/stars in favour of takram's
  leaves no gaps.
- **Q2 (units) — RESOLVED: both, in sections (D0).** `atmosphere.json` carries a
  `render` section serialized in takram's own units (option A — no converter, coupling
  quarantined) and a `physics` section in renderer-agnostic SI fed straight to the drag
  model (no converter either). Each section dodges the unit trap for a different reason,
  so the `~0.0058` per-km vs `5.8e-6` per-metre mismatch never needs reconciling.
- **Q3 (terrain limb) — Does `PlanetTerrainTiles` LOD cover the horizon cleanly at
  real altitudes, or does the spike's facet-sag seam reappear?** Verify before
  assuming the tile system owns the limb.
- **Q4 (perf) — Is the composer + effect actually cheaper per frame than the v1
  shell's ~28 fps (planet-fills-screen)?** Expected far cheaper (LUT lookups vs a
  128-iteration raymarch); measure on that case to confirm.

## Testing

- Unit: the `atmosphere.json → AtmosphereParameters` mapper; LUT cache keying.
- Existing `renderLayers.test.ts` updated for the new pass structure.
- Manual/visual: `two-stage-ascent` (ascent through atmosphere), `sun-earth-moon`
  (Moon from surface, eclipse gating), planet-fills-screen perf check.
- Gate: `npm run check` (typecheck + lint + tests) green throughout.
