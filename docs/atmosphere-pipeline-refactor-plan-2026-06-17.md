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
- **Deep space (NOT fogged):** stars, the sun, the moon, and **distant celestial
  body disks** (other planets via `projectDistantSphere`, the emissive sun at
  `SUN_RENDER_DISTANCE`). takram's `Sky`/effect already render stars + sun + moon
  correctly. Distant *planet disks* drawn as geometry must bypass aerial-perspective
  fogging (otherwise they're fogged as if at atmosphere-grazing distance — wrong).
  See open question Q1.

## Key design decisions

### D1 — Depth buffer
Use one coherent depth buffer (drop the inter-pass `clearDepth`). The spike showed a
standard buffer is sufficient at `near:0.1 far:1e9` for the near field. Keep
`logarithmicDepthBuffer` in reserve (spike confirmed it doesn't break takram's depth
reconstruction) — only adopt it if a real vehicle exposes sub-mm part precision
issues the standard buffer can't hold. Prefer instead a **sane far plane for the
fogged pass** + distant bodies in their own pass (D2).

### D2 — Distant bodies
Render distant celestial disks + stars in a pass that is **not** consumed by
`AerialPerspective` (e.g. rendered after the composite, or on a layer the effect's
depth treats as background). Recommended: let takram render sun/moon/stars; render
other-planet disks as a thin overlay pass on top of the composite. Validate against
`sun-earth-moon` (Moon visible from Earth surface) and `inner-solar-system`.

### D3 — Per-body params (`atmosphere.json` → `AtmosphereParameters`)
Map the plugin asset to Bruneton params:

| atmosphere.json | AtmosphereParameters | notes |
|---|---|---|
| (body `physics.radius`) | `bottomRadius` | ground radius — must match the rendered surface |
| `shellHeight` | `topRadius = bottomRadius + shellHeight` | |
| `rayleigh.coefficients` | `rayleighScattering` (Vector3) | **unit calibration needed** (see Q2) |
| `rayleigh.scaleHeight` | `rayleighDensity` profile (exp) | build `DensityProfileLayer` |
| `mie.coefficient` | `mieScattering` / `mieExtinction` | |
| `mie.scaleHeight` | `mieDensity` profile (exp) | |
| `mie.anisotropy` | `miePhaseFunctionG` | |
| `sunIntensity` | `solarIrradiance` / light intensity | calibrate to takram's luminance units |

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

### D6 — Lighting
Replace the ad-hoc `VehicleSunLight` + ambient with takram's `SunLight`
(`SunDirectionalLight`, color/intensity from the transmittance LUT) and
`AerialPerspective`'s `skyLight`. Keep sun-occlusion logic (eclipse handling) by
gating `SunLight` intensity with the existing `isSunOccluded` check.

## Implementation phases

1. **Composer skeleton.** Stand up `EffectComposer` in `VehicleScene`, render the
   existing layers into it as one coherent pass (drop the depth clear), no atmosphere
   yet. Verify the vehicle + terrain + distant bodies still look right and the
   `activeView` gating still works. *Checkpoint: parity with today, minus the v1 shell.*
2. **atmosphere.json → AtmosphereParameters mapper** + per-body LUT cache (D3, D4).
   Unit-tested pure mapping function. Calibrate against `AtmosphereParameters.DEFAULT`.
3. **Place + light.** Wire `worldToECEFMatrix` + `sunDirection` per frame (D5);
   swap in `SunLight` + `skyLight`, preserve eclipse gating (D6).
4. **Atmosphere on.** Add `Sky` + `AerialPerspective`; confirm aerial perspective over
   terrain + vehicle and the sky/horizon. Tune exposure/tone-map.
5. **Distant bodies pass** (D2); validate Moon-from-Earth and multi-body scenarios.
6. **Remove v1.** Delete `AtmosphereShell.tsx`, `atmosphereScatter.ts`, the
   `atmosphere` render layer/pass; update `renderLayers` + its test. Keep
   `atmosphere.json` schema + plugin model.
7. **Spike teardown.** Remove `/_spike/atmosphere` + its menu link once the real path
   lands (or keep as a dev sandbox — decide at the end).

## Open questions to resolve during implementation

- **Q1 (distant bodies):** cleanest way to exclude distant planet disks from
  aerial-perspective fogging within one composer — separate overlay pass vs. a
  depth/stencil trick. Lean overlay pass.
- **Q2 (units):** takram's `AtmosphereParameters.DEFAULT.rayleighScattering` is
  `~0.0058` while our `atmosphere.json` uses `5.8e-6` (per-metre) with
  `bottomRadius` in metres — implying an internal length-unit (km?) scale. Pin the
  exact conversion before trusting custom params; DEFAULT is self-consistent (spike
  used it and looked right), so calibrate the mapper against DEFAULT.
- **Q3 (terrain limb):** confirm `PlanetTerrainTiles` LOD covers the horizon cleanly
  so we don't reintroduce the spike's facet-sag seam at real altitudes.
- **Q4 (perf):** measure composer + effect cost vs. the v1 shell's 28 fps; the LUT
  approach should be far cheaper per frame, but verify on the planet-fills-screen case.

## Testing

- Unit: the `atmosphere.json → AtmosphereParameters` mapper; LUT cache keying.
- Existing `renderLayers.test.ts` updated for the new pass structure.
- Manual/visual: `two-stage-ascent` (ascent through atmosphere), `sun-earth-moon`
  (Moon from surface, eclipse gating), planet-fills-screen perf check.
- Gate: `npm run check` (typecheck + lint + tests) green throughout.
