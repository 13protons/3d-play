# Visual realism — spec & roadmap (2026-06-17)

Goal: make the sim *fun to look at and fly* — the physics is solid (multi-part
mass/inertia, gimbaled thrust, atmospheric Isp, aero drag + center of pressure),
but the presentation is primitive. This spec scopes a visual-realism push across
four fronts and is written so a fresh agent with no prior context can pick it up.

**Start here:** the agent should first *verify the rendering pipeline facts* in
"Pipeline facts to confirm" (below) — they're inferred from prior work and not
fully re-checked — then implement in the priority order given.

## Current state (the gaps)

- **Sky is pure black even sitting on the ground.** No atmospheric rendering at
  all. This is the most jarring gap and the headline of this spec.
- **Vehicle is primitive** cylinders/cones with flat `meshStandardMaterial`
  colors (`src/render/Vessel.tsx`, `PartShape`).
- **Terrain is flat-ish green** (`src/render/terrain/*`, `BodyMaterial.tsx`).
- **Sun/lighting is minimal** — a dim ambient light (intensity ~0.04) + a
  directional light; no sun disc, no bloom, no HDR.

## Pipeline facts to confirm (verify before building)

These are inferred from earlier work; the agent should re-confirm in code:

- **Renderer:** R3F `<Canvas>` in `src/render/VehicleScene.tsx`, `gl={{ autoClear:
  false }}`. Confirm camera type/fov/near/far, color space, tone mapping.
- **Manual multi-pass render:** `VehicleSceneRenderPasses` (~`VehicleScene.tsx:360`)
  loops `TERRAIN_RENDER_PASSES` (`src/render/renderLayers.ts`): for each pass it
  sets `camera.layers.set(pass.layer)` and calls `gl.render`, with `gl.clear()`
  once up front and `gl.clearDepth()` before the vehicle pass. Layers:
  `baseBody=0`, `terrainOverlay=1`, `vehicle=2`. **Implication:** anything new
  must be assigned to a layer and slotted into a pass, or it won't render. This
  also means **`@react-three/postprocessing` EffectComposer will not "just work"**
  — it expects to own the render loop. Bloom has to cooperate with this manual
  multi-pass (see Sun & bloom).
- **Floating origin:** the followed vehicle sits at/near the scene origin; bodies
  are positioned relative each frame. Confirm where a body's world position +
  radius (in *scene units*) come from, and the **metres ↔ scene-unit scale**
  (need planet render radius in scene units; vehicle render scale is 0.15
  m→units per `Vessel.tsx`, but planets use a different/own scale — confirm).
- **Sun direction:** find the sun body's position in the scene and derive a
  world-space **sun direction** (needed by scattering + lighting + sun disc).
  Confirm whether the existing directional light already tracks the sun.
- **Existing background:** drei `<Stars>` is imported in `VehicleScene.tsx` —
  confirm how it's used and on which layer, so the atmosphere sorts in front of
  stars but behind/around the planet.
- **Altitude in-scene:** atmosphere fade should key off camera altitude =
  `|cameraWorld − planetCenter| − planetRadius` in scene units (NOT the sim's
  `pressureRatio`, which is vehicle-specific and lives in the worker). The body's
  `atmosphereModel` / scale-height data may be fetchable for the fade curve.

## 1. Atmosphere & sky (priority 1 — most transformative)

The flagship. Camera flies surface → orbit, so it must work *inside and outside*
the atmosphere and transition smoothly.

**Recommended approach — single-scattering atmosphere shell** (Sebastian Lague /
GPU Gems 2 "Accurate Atmospheric Scattering" style):

- Render a sphere at `planetRadius + atmosphereHeight`, **front faces culled** (so
  it's visible both from inside, looking out, and from outside as a shell).
- Fragment shader ray-marches the view ray through the atmosphere, accumulating
  Rayleigh (blue, wavelength-dependent) + Mie (haze/forward sun glow) in-scattering
  using optical depth toward the sun. Inputs: camera position, planet center +
  radius, atmosphere height, sun direction, scattering coefficients.
- Result for free: blue sky overhead + warm horizon from the surface, a blue limb
  halo from orbit, sunset reddening near the terminator, and a natural blue→black
  fade with altitude (the path length through atmosphere shrinks).
- Blend additively over the scene (atmosphere is in-scattered light on top of
  whatever's behind: planet surface or stars/space).

**Integration gotchas:**
- Floating origin: feed the shader the planet center *relative to the camera* (or
  in the same shifted frame the rest of the scene uses) — don't use raw world
  coords that overflow float precision.
- Multi-pass: assign the atmosphere to its own render order — it must draw *after*
  the planet surface (so it scatters over it) and *after* stars, but the planet
  must still occlude the sky behind it. Likely a dedicated pass/layer between
  terrain and vehicle, or additive blending with depth-test against the surface.
  Re-confirm the pass ordering and add an atmosphere pass.
- Scale: the real Rayleigh/Mie coefficients assume metres; either work in scene
  units with rescaled coefficients or do the math in a metres frame. Keep the
  scale factor a single tunable constant.
- Performance: ray-march with modest step counts (view ~16, sun ~8); it's a
  fullscreen-ish shell so keep it cheap. Precomputed LUTs (Bruneton) are the
  upgrade path if needed — out of scope for v1.

**Simpler fallback if the shell shader is too much for a first cut:** drei `<Sky>`
(Preetham analytic dome) gated to the vehicle/surface view + a separate
fresnel-glow shell sphere for the orbital limb, cross-faded by altitude. Less
unified but far less shader work. Note it won't transition as cleanly.

**Tunables to expose:** atmosphere height, Rayleigh/Mie coefficients & scale
height, sun intensity, fade curve. Per-body (Earth blue; others later).

## 2. Sun & lighting / bloom (priority 2 — cheap polish, pairs with #1)

- **Sun disc:** a bright billboarded sprite/mesh at the sun direction (far, or a
  fixed-distance billboard), with a soft falloff. Color/size tunable.
- **HDR bloom:** the glow that sells the sun + bright limb. **Blocker:** the manual
  multi-pass render means `@react-three/postprocessing`'s `<EffectComposer>` can't
  simply wrap the scene. Options: (a) refactor the multi-pass to render into a
  render target the composer then bloom + tone-maps; (b) a custom bloom pass
  appended after the existing passes operating on the framebuffer. Pick after
  confirming the pass setup; (a) is cleaner long-term.
- **Lighting:** make the directional light track the sun direction, raise its
  intensity, drop ambient or replace with a cheap hemisphere/IBL so the lit side
  reads as sunlit and the dark side is genuinely dark. Consider ACES tone mapping
  + sRGB output once HDR/bloom is in.

## 3. Vehicle part meshes (priority 3 — high impact, content-heavy)

Replace `PartShape`'s primitives with real part models. This is also the
**trigger for GPU wind-shadow aero** (see `docs/wind-shadow-aero-2026-06-17.md`).

- Add a mesh reference to `PartDefinition` (a `meshId` already exists, unused) and
  a small registry of GLTF/procedural part meshes; `Vessel.tsx` swaps `PartShape`
  for the referenced mesh, keeping the existing transform/flame/CoM-pivot wiring.
- Materials: PBR (metalness/roughness), reacts to the new sun lighting.
- Keep the debug overlay (engine markers, CoM/CoP, thrust/torque/drag rays)
  working — it reads body-frame geometry, independent of the mesh.
- Content: either author a few GLTF parts or build nicer procedural geometry
  (nozzles, interstage, capsule shape). Start with the two-stage-ascent craft.

## 4. Terrain detail (priority 4)

- Surface textures + normal/relief shading (triplanar to avoid UV seams on a
  sphere), biome/altitude-based coloring instead of flat green
  (`BodyMaterial.tsx`, `terrain/*`, `bodySurfaceGeometry.ts`).
- Atmospheric/aerial perspective: distant terrain tinted toward the sky color
  (ties into #1 — share the scattering or a cheap distance fog matched to it).
- Confirm the terrain LOD/tile system (`PlanetTerrainTiles`, `terrainLodPolicy`)
  and feed detail textures through it without breaking LOD.

## Suggested order & rationale

1. **Atmosphere & sky** — biggest transformation, every scene benefits, ties to
   the atmosphere physics already in the sim.
2. **Sun & bloom** — small, makes #1 sing (the bright limb + sun glow need HDR).
   Do the bloom/multi-pass refactor here since #1 also benefits.
3. **Vehicle meshes** — high impact; also unblocks GPU wind-shadow aero.
4. **Terrain detail** — rounds it out; reuses the scattering for aerial
   perspective.

## Non-goals / deferred

Precomputed multiple-scattering LUTs (Bruneton); volumetric clouds; ocean
shaders; per-part PBR texture authoring at scale; GPU wind-shadow aero (separate
doc, triggered by #3).
