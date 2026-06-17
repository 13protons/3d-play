# Atmosphere rendering — research & decision record (2026-06-17)

Decision record for how we render planetary atmospheric scattering, written after
a first-cut implementation revealed the approach was wrong. **Decision: adopt
[`@takram/three-atmosphere`](https://github.com/takram-design-engineering/three-geospatial)
on the pmndrs [`postprocessing`](https://github.com/pmndrs/postprocessing)
pipeline.** This doc captures why, so the integration work (a follow-up) has full
context.

## What we built first (and why it's being replaced)

A single-scattering atmosphere shell (`src/render/AtmosphereShell.tsx` +
`atmosphereScatter.ts`): a back-face-culled sphere at `planetRadius +
shellHeight`, additive-blended, with a per-fragment ray-march (16 view samples ×
8 light samples = 128 iterations/pixel) that bounds the march by intersecting the
planet sphere analytically. Driven by a per-body `atmosphere.json` asset.

It got the *idea* across — blue sky on the ground, illuminates terrain, fades
with altitude — but five problems showed it's the wrong approach:

1. **Black gap between sky and ground**, worsening with altitude.
2. **Sky dramatically over-illuminates the ground.**
3. **No visible atmosphere fade-off into space.**
4. **Noticeably laggy** — FPS 60 → ~28 when the planet fills the screen.
5. **No atmosphere at all in the orbital view.**

### Root causes

- **Perf (#4) is fragment-bound, not geometry-bound.** Perf log:
  `draws:9, tris:624` (trivial geometry) yet `maxMs` jumps 18 → 100–160ms the
  moment the planet fills the screen. That's the 128-iteration ray-march running
  over a full screen of pixels. Inherent to an un-accelerated raymarched shell.
- **Over-illumination (#2) — additive is only half the equation.** Real aerial
  perspective is `result = background × transmittance + inscatter`. The shell did
  only the `+ inscatter` half and tone-mapped the long-path horizon toward white,
  so it *adds* near-white over terrain instead of *attenuating then adding*.
- **Black gap (#1) & no space fade (#3)** — the shell composites against an
  analytic `planetRadius` sphere, not the actual rendered terrain depth, and has
  no soft falloff into space. Where analytic and rendered horizons disagree, and
  where additive inscatter dips, you get a dead band.
- **No orbital atmosphere (#5) — scoping.** `Scene` (orbital/map view) and
  `VehicleScene` are separate canvases; the shell only mounted in the latter.

**Common thread:** every correctness bug traces to *additive-shell-without-depth*,
and the perf bug to *un-accelerated raymarch*. Both are solved by the same shape:
a screen-space pass that reads scene depth, composites
`scene × transmittance + inscatter`, and uses precomputed textures (LUTs) so each
sky pixel is a cheap lookup.

## Technique landscape (research summary)

| Approach | Runtime cost | Multiple scattering | Ground↔orbit | WebGL2 reality |
|---|---|---|---|---|
| Analytic sky (Preetham / Hosek-Wilkie; three.js `Sky`) | ~free | no | **no** (hemisphere dome only) | ships with three; ground-only |
| Single-scattering raymarch (Nishita; **our v1**) | O(n×m), fragment-bound | no | yes | wwwtyro/glsl-atmosphere |
| Single-scattering + transmittance LUT (O'Neil; Sebastian Lague) | O(n) | no | yes | easy port; kills the inner loop |
| **Bruneton 2008** precomputed | constant-time lookups; ~250ms one-time bake | **yes (ground truth)** | **yes** | proven in WebGL2 (ebruneton demo, BSD-3); 4D LUT |
| **Hillaire 2020** ("Scalable…"; UE SkyAtmosphere) | ~0.3ms/frame @720p | yes (O(1) approx) | **yes** | best-in-class; **no WebGL2 port** (WebGPU only) |

**The universal perf fix** is to bake the scattering integral into small textures
(LUTs). The biggest single win for a raymarch is a **transmittance LUT** that
removes the inner sun-march (O(n×m) → O(n), ~10×); add half-res + blue-noise +
~10 samples and 60fps returns. **Correctness** (over-illumination, black gap)
requires the **scene depth buffer** and `scene × transmittance + inscatter`
compositing — i.e. a screen-space post pass, not a naive additive shell.

Key sources:
- Hillaire 2020 paper: https://sebh.github.io/publications/egsr2020.pdf · ref impl (HLSL): https://github.com/sebh/UnrealEngineSkyAtmosphere
- Bruneton WebGL2 demo: https://ebruneton.github.io/precomputed_atmospheric_scattering/
- O'Neil, GPU Gems 2 ch.16 · Sebastian Lague: https://github.com/SebLague/Solar-System
- wwwtyro/glsl-atmosphere (single-scatter drop-in)

## Why a post-processing pipeline is needed regardless

Three independent reasons converge on adopting a real post-processing pipeline
(render scene → target → fullscreen effect passes → screen):

1. **Bloom is Priority 2** of the visual-realism spec — the textbook post effect.
2. **The atmosphere fix needs render-to-target + depth** to composite over the
   scene; that *is* a mini post pipeline.
3. **Everything after** (ACES tone-map pass, AA, aerial-perspective fog for
   terrain, god rays, color grading) is also post.

So the render-to-target refactor is **foundational, do-once** work — load-bearing
for atmosphere *and* bloom *and* the rest. Decision: **adopt the industry-vetted
pmndrs `postprocessing` library**, not a hand-rolled composer. (Note: our current
renderer hand-rolls a manual multi-pass loop in `VehicleSceneRenderPasses`, which
EffectComposer expects to own — reconciling those is the core integration task.)

## Buy vs. build: why takram

Initial worry was that `@takram/three-atmosphere` is Earth-geospatial-locked and
would fight our floating-origin, multi-body, metres scene. **Investigating the
actual source debunked both objections:**

- **Coordinate frame is configurable.** Issue
  [#11 "Ability to configure the reference frame"](https://github.com/takram-design-engineering/three-geospatial/issues/11)
  is *exactly* our concern (meter-scale ECEF precision; wanting to work near the
  world origin) and it was resolved: the library exposes **`worldToECEFMatrix:
  Matrix4`** on `AerialPerspectiveEffect` and `AtmosphereMaterialBase`. Garrett
  Johnson (gkjohnson, maintainer of NASA `3DTilesRendererJS`) wired it into a
  floating-origin app in that thread and wrapped takram's `<Atmosphere>` to drive
  it from a parent group transform. Live "moving-ellipsoid" storybook example
  exists.
- **Arbitrary planets + custom atmospheres are configurable.**
  `AtmosphereParameters.ts` exposes `bottomRadius` (planet radius), `topRadius`,
  `rayleighScattering`/`rayleighDensity`, `mieScattering`/`mieExtinction`/
  `miePhaseFunctionG`, `absorptionExtinction`, `groundAlbedo`, `solarIrradiance`,
  with general layered `DensityProfile`s — the full Bruneton parameter set. A
  **`PrecomputedTexturesGenerator`** bakes the LUTs at runtime for *custom*
  params, not just Earth's pre-baked textures. This maps ~1:1 onto our per-body
  `atmosphere.json` plugin model.
- **Scale already matches** — our scene is real-metre scale (Earth =
  6,371,000 m), the same as takram's ECEF metre scale. No rescaling fight.
- **`postprocessing` requirement is no longer a cost** — we're adopting that
  pipeline anyway.

takram is MIT, maintained (v0.19.1, 2026-05-06), supports `three >= 0.170`
(so r0.183), WebGL2, full multiple-scattering, native ground-to-orbit, and ships
`SunDirectionalLight`, `SkyLightProbe`, stars, and a clouds sibling package that
can absorb later spec items. Building our own would be strictly worse on every
axis that matters here. (Hillaire from scratch was the only "better" option and
has no WebGL2 port — multi-day work for marginal gain over takram's results.)

## The one real integration risk — spiked, and it did not bite

**The risk.** Our vehicle renderer **intentionally clears the depth buffer between
the planet pass and the vehicle pass** (`clearDepthBefore: true`, `renderLayers.ts`)
to avoid z-fighting between a 6,371 km planet and a ~10 m rocket under one camera
(`near: 0.1, far: 1e9`). takram's **aerial-perspective effect reconstructs world
position from a single coherent depth buffer** (`inverseProjectionMatrix` /
`inverseViewMatrix` / `cameraPosition` uniforms; optional `reconstructNormal`, no
normal buffer needed) to fog terrain/objects. Those facts are in tension: the
refactor must drop the depth clear and feed takram one coherent buffer — which
could look fine in a demo yet z-fight in our scene.

**The spike** (`src/spike/AtmosphereSpike.tsx`, route `/_spike/atmosphere`, isolated
from `VehicleScene`). Stood up the exact pipeline the refactor would produce, in
miniature: takram `<Atmosphere>` + `<AerialPerspective>` (sky + aerial perspective)
inside a pmndrs `<EffectComposer>` with `<SunLight>`; LUTs baked at runtime on the
GPU via `PrecomputedTexturesGenerator` (no CDN/EXR fetch); a real-scale planet
(radius = takram's `bottomRadius` = 6,360 km, **not** 6,371 km — they must match or
the surface floats) placed by **floating origin** (scene origin on the surface,
`worldToECEFMatrix` a pure translation, camera near origin); and a multi-part near
"vehicle" sharing **one coherent depth buffer** with the planet under `near:0.1
far:1e9`. A `?log=1` toggle switches on `logarithmicDepthBuffer`.

**Findings — all positive:**

| Question | Result |
|---|---|
| takram renders in our exact stack (R3F 9.5 / three r0.183 / WebGL2)? | **Yes**, with runtime-baked LUTs — no external assets |
| Aerial-perspective + sky compositing over real geometry, real metre scale, floating-origin placement? | **Correct** and good-looking |
| **The flagged risk** — planet + near vehicle in one coherent depth buffer at `near:0.1 far:1e9`? | **No precision z-fighting.** 24-bit depth resolves cm-gaps at ~15 m with ~750 levels to spare; math and the spike agree |
| Does logarithmic depth break takram's depth→position reconstruction? | **No** — atmosphere stays correct with log depth on, so it's available if ever needed |

**Two red herrings, both rig artifacts (not takram):**

1. *Near-object "flicker."* Initial test geometry had a body cylinder whose base was
   **coincident** with the top plate (equal radius + overlapping height). Coincident
   surfaces z-fight regardless of depth precision or log mode. Separating the parts
   with clean air gaps removed it entirely — confirming the coherent buffer is fine.
2. *Black horizon line.* A single low-poly `sphereGeometry` approximates the 6,360 km
   limb with flat facets that sag below the true horizon by `R·½·(π/N)²` — ~7.6 km at
   N=64 — exposing a dark grazing-ground sliver. Cranking tessellation shrank it ~60×.
   **The real renderer never fakes a planet with one sphere** — near ground is the
   tiled terrain (`PlanetTerrainTiles`), so the limb is the tile LOD's job.

**Verdict: green light for the full pipeline refactor.** The depth tension is real
but resolvable simply (one coherent buffer with a sane depth config; distant bodies
in a separate non-fogged pass), and every "does it even work" unknown is retired.
See `docs/atmosphere-pipeline-refactor-plan-2026-06-17.md` for the refactor plan.

## What landed in this PR (progress so far)

- **Per-body plugin bundles.** All 12 bodies migrated to
  `public/data/bodies/<id>/manifest.json` with assets in `<id>/textures/` (and
  Earth's `atmosphere.json`), fetched over the network. Bridge loads only the
  bodies a scenario references. Removed the flat `<id>.json` files and the shared
  `public/data/textures/` folder. (This part stays — it's independent of the
  atmosphere technique.)
- **`atmosphereRender` config** plumbed through `BodyMeta` from the linked
  asset; validation updated for the plugin layout.
- **v1 single-scattering shell** (`AtmosphereShell.tsx`, `atmosphereScatter.ts`,
  the `atmosphere` render layer/pass). **Superseded by the takram decision** —
  kept here as the checkpoint that motivated this research; it will be removed
  when takram lands. The `atmosphere.json` schema and the per-body plugin model
  carry forward.

## Follow-up work

1. ~~**Spike** the takram + `postprocessing` integration against our split-depth
   multi-pass.~~ **Done — green** (see "spiked" section above). Deps added
   (`@takram/three-atmosphere`, `@takram/three-geospatial`,
   `@react-three/postprocessing`, `postprocessing`); spike lives at
   `/_spike/atmosphere`, lazy-loaded and out of the main bundle.
2. **Adopt the pipeline** — see the dedicated plan,
   `docs/atmosphere-pipeline-refactor-plan-2026-06-17.md`: migrate `VehicleScene`'s
   manual multi-pass into a pmndrs `EffectComposer`; map per-body `atmosphere.json`
   → `AtmosphereParameters` (+ runtime LUT gen, cached per body); place bodies via
   `worldToECEFMatrix`; replace the v1 shell and ad-hoc sun light with takram's
   `Sky` / `SunDirectionalLight` / `AerialPerspectiveEffect`.
3. **Bloom (Priority 2)** on the same composer.
4. **Orbital view** atmosphere (separate canvas) as its own integration.
