# Vehicle Part Meshes — procedural sandbox → baked assets

Replace the flat primitive shapes that render vehicle parts today with believable
rocket hardware. Parts are **sculpted procedurally in an authoring sandbox**, then
**baked to static `.glb` meshes** that ship in the repo. Gameplay **loads the baked
mesh** — it never generates geometry at load time. Procedural generation is an
authoring-time tool; the runtime just loads an asset.

This is front #3 ("vehicle part meshes") of `docs/visual-realism-spec-2026-06-17.md`,
now that fronts #1 (atmosphere) and #2 (sun/bloom) have shipped. The vehicle physics
model (multi-part mass/inertia, staging, gimbal, aero) is complete and independent of
how parts are drawn — this project touches rendering only.

## Goal

The `two-stage-ascent` craft should read as a real rocket in a screenshot under the
current sun + atmosphere lighting: shaped bell nozzles, tank bodies with ribs/panel
lines, a capsule silhouette, and PBR metal/paint materials — with no external art
assets and no runtime procedural cost.

## Current state (what we're changing)

- Each `PartDefinition` (`src/sim/vehicle/parts.ts`) carries a `render` hint —
  `{ shape: 'cylinder'|'box'|'cone', radius, length, color }` — and an **unused**
  `meshId?: string` field.
- `Vessel.tsx`'s `PartShape` draws that hint as a flat-shaded primitive
  (`meshStandardMaterial color`). The engine flame is a `sphereGeometry` at the
  nozzle, made visible when the part's stage is firing and throttle > 0.
- Parts are placed by the physics-derived transform inside a group carrying craft
  orientation, a CoM pivot, and a single metres→scene scale
  (`VEHICLE_RENDER_SCALE = 0.15`). Length runs along each part's **local +Z**.
- The `two-stage-ascent` craft is three parts: `booster` (cylinder, engine+tank),
  `upper` (cylinder, engine+tank), `capsule` (cone, reaction wheel).
- No GLTF dependency is installed, but `three` ships `GLTFExporter` and `drei`
  provides `useGLTF` — both already available. **No new dependencies.**

## Scope

**In scope:**
- A code-driven parts sandbox at `/_spike/parts` (following the existing spike-route
  pattern: `src/spike/*`, `appRoutes.ts`, main-menu link).
- Pure, deterministic procedural geometry builders in `src/spike/parts/`: tank/body,
  bell nozzle, capsule, interstage/decoupler ring, and reusable greeble details.
- PBR materials (`meshStandardMaterial` metalness/roughness/color) authored to read
  true under gameplay lighting.
- An **Export GLB** action in the sandbox (`GLTFExporter` → browser download).
- Baked assets committed to `public/models/parts/`.
- Runtime load in `Vessel.tsx`: a `BakedPart` component using `useGLTF`, keyed off
  `PartDefinition.meshId`, with the existing `PartShape` primitive as fallback.
- Plume upgrade: replace the sphere with a **textured conic extension of the bell**,
  anchored at the nozzle exit, still a runtime effect gated by throttle + active stage.
- Bake the three `two-stage-ascent` archetypes (`booster`, `upper`, `capsule`) and
  set their `meshId`s. The bell nozzle is a **shared builder** baked *into* the
  engine-bearing part meshes (booster/upper) — engines are modules on those parts, not
  separate part instances, so there is no standalone nozzle asset.

**Out of scope (deferred):**
- On-screen slider / inspector UI for the sandbox (code + HMR only for now).
- Per-instance runtime material tint (baked material is authoritative).
- Mesh LOD / decimation.
- A physically dynamic plume (exhaust velocity, particles, altitude expansion).
- GPU wind-shadow aero (`docs/wind-shadow-aero-2026-06-17.md`, a separate trigger).
- A headless build-time bake script (the manual Export button is enough now).
- Parts beyond the demo craft; a VAB-style build editor.
- Moving builders out of `src/spike/` (they graduate later if re-baking gets frequent).

## Architecture — three seams

```
  AUTHOR                         BAKE                         CONSUME
  ┌────────────────────┐         ┌───────────────┐            ┌──────────────────────┐
  │ /_spike/parts       │  Export │ GLTFExporter  │  commit    │ Vessel.tsx            │
  │ code-driven + HMR   │ ──────▶ │ → <id>.glb    │ ─────────▶ │ meshId → useGLTF      │
  │ builders + PBR      │  GLB    │ public/models │  to repo   │ fallback → PartShape  │
  └────────────────────┘         └───────────────┘            └──────────────────────┘
       src/spike/parts/                                             + conic plume
```

The seams are independent: the sandbox can change without touching gameplay; the
runtime only knows "load this `.glb`"; the builders are pure functions testable in
isolation.

### 1 — Authoring sandbox (`/_spike/parts`)

- New route registered in `src/appRoutes.ts` (a `spikePartsPath = '/_spike/parts'`)
  and the main-menu links, mirroring `/_spike/dawn` / `/_spike/atmosphere`.
- `src/spike/PartsSandbox.tsx`: an R3F canvas rendering **one** selected part
  (`const PART = 'booster'` at the top of the file — no picker UI), centered at the
  origin, under a sun-like directional light + modest ambient/environment matching
  gameplay, with `OrbitControls` and a **1 m reference grid** so proportions stay
  honest. Editing builder params in source + Vite HMR is the iteration loop.
- One button: **Export GLB** — runs `GLTFExporter` on the part's group and triggers a
  browser download named `<partId>.glb`.

### 2 — Procedural builders (`src/spike/parts/`)

Pure functions returning THREE geometry/`Group` objects. No randomness that varies
between runs (greeble placement is deterministic from params/seed). Proposed modules:

- `tankBuilder.ts` — revolved (`LatheGeometry`) body profile: cylinder with
  domed/tapered end caps; optional rib rings, panel-line insets, a conduit/cable strip.
- `nozzleBuilder.ts` — bell nozzle: lathed throat→expansion curve + engine mount.
  Reused inside engine-bearing part builders.
- `capsuleBuilder.ts` — revolved gumdrop profile + heat-shield base + window band.
- `interstageBuilder.ts` — short ribbed collar marking a stage cut.
- `greebles.ts` — reusable small detail meshes (boxes/pipes) placed by params.
- `materials.ts` — a few shared PBR materials (brushed metal, painted band, heat
  shield) as tunable constants.

**Convention (non-negotiable — makes baked meshes drop in with zero fixup):**
- Units: **metres** (real dimensions). The `VEHICLE_RENDER_SCALE` group handles
  metres→scene units at runtime.
- Origin: at the **part origin** (which the physics also treats as the dry CoM).
- Long axis: **local +Z**, mesh centered so it spans roughly `±length/2` on Z.
- Engine parts: the **nozzle exit sits at the −Z end** (≈ `−length/2`), so the
  existing plume anchor math (`nozzleZ = −length/2 − 1`) still lines up.
- Keep polycount modest — parts are small on screen.

### 3 — Baked assets

- Path: `public/models/parts/<id>.glb` (e.g. `booster.glb`, `upper.glb`,
  `capsule.glb`). Materials are baked into the GLB.
- Committed to the repo as normal assets.

### 4 — Runtime integration (`src/render/Vessel.tsx`)

- New `BakedPart({ meshId })`: `const { scene } = useGLTF('/models/parts/' + meshId + '.glb')`,
  clone it (drei caches the loaded scene; each instance must render its own clone),
  render the clone. The existing `setLayerRecursively(group, RENDER_LAYERS.vehicle)`
  in the `useFrame` loop already walks children, so loaded meshes inherit the vehicle
  layer without extra work — **verify this holds for a cloned GLTF subtree**.
- Selection: in the `placed` mapping, if `def.meshId` is set render `<BakedPart>`,
  else render today's `<PartShape render={p.render} />`. Migration is per-part; a craft
  can mix baked and primitive parts with nothing breaking.
- `render.length` is **retained even for baked parts** as the plume anchor; baked parts
  ignore `render.color`/`shape` (the GLB material is authoritative).
- Pull the `meshId`→url mapping and the baked-vs-primitive decision into a tiny pure
  helper (e.g. `partMeshUrl(meshId)` + a `usesBakedMesh(def)` predicate) so it's unit
  testable without a renderer.
- `useGLTF.preload(...)` the craft's part meshes.

### 5 — Plume upgrade

- Replace the `sphereGeometry` flame with a **textured conic mesh** that continues the
  nozzle bell's flare, anchored at the nozzle exit (same `nozzleZ` anchor as today).
- Still a runtime effect: visible only when the part's stage is the firing stage and
  throttle > 0 (the existing `flames` gating logic is unchanged). Optionally scale
  length/opacity with throttle.
- Explicitly **not** physically dynamic — no exhaust velocity, particles, or altitude
  expansion. KSP-style "smoke placed in the wake." The bell defines where it starts.

## Data flow

1. Author edits a builder's params in `src/spike/parts/*.ts`; HMR re-renders the
   sandbox part.
2. When it looks right, **Export GLB** downloads `<id>.glb`; the author moves it into
   `public/models/parts/`.
3. The part's `PartDefinition.meshId` is set (in `two-stage-ascent.json`'s `partDefs`)
   to `<id>`.
4. In gameplay, `Vessel.tsx` sees `meshId`, `useGLTF` loads the committed `.glb`, and
   the part renders as baked hardware; the plume anchors at its nozzle exit.

## Testing

- **Builders (unit, Vitest):** for each builder, assert the bounding box ≈ the
  requested dimensions, the geometry is centered at origin on the long axis, the long
  axis is +Z, the nozzle exit (engine parts) is at the −Z end, and output is
  deterministic for fixed params. These are pure functions — no renderer needed.
- **Runtime selector (unit):** `partMeshUrl` builds the expected path; `usesBakedMesh`
  returns true iff `meshId` is set; the fallback path is chosen when it's absent.
- **Export + fidelity (manual):** drive `/_spike/parts` to eyeball each part and
  export; drive the `two-stage-ascent` mission (`/run`) to confirm the assembled craft
  loads baked meshes, sits correctly (scale/origin/axis), stages cleanly, and the plume
  fires at the right nozzle. GLTFExporter runs in the browser, so it is verified by
  driving the sandbox rather than in a jsdom unit test.

## Assumptions to verify during implementation

- A cloned `useGLTF` scene subtree accepts `setLayerRecursively` and renders on the
  vehicle layer through the existing multi-pass pipeline (`renderLayers.ts` /
  `VehicleSceneRenderPasses`).
- `GLTFExporter` output loaded back via `useGLTF` preserves the authored PBR materials
  and the metres scale/origin/axis convention (round-trip in the sandbox before
  committing).
- Baked PBR materials read correctly under the current tone-mapping / color-space
  setup used by the vehicle view.

## Success criteria

- The `two-stage-ascent` craft renders booster, upper stage, and capsule as baked
  procedural meshes with PBR materials, and looks like a rocket in a screenshot under
  current lighting.
- No geometry is generated at load time in gameplay; parts load from committed `.glb`.
- Any part without a `meshId` still renders via the `PartShape` primitive fallback.
- The engine plume is a textured conic anchored at the nozzle exit, firing on the
  active stage at throttle.
- Builder unit tests and the runtime-selector tests pass; typecheck and lint clean.
