# Atmosphere LUT pre-compute pipeline — design note (2026-06-18)

Deferred idea, captured for later. **Do NOT build this yet** — pre-baking the LUT
locks in the atmosphere parameters, and we still expect to tune them (especially for
realtime performance). Keep runtime generation while iterating; pre-bake once the
params are stable.

## The problem it solves

takram's atmosphere needs precomputed Bruneton lookup tables. We currently bake them
**at runtime** with `PrecomputedTexturesGenerator(gl).update(params)` (see
`src/render/atmosphere/atmosphereTextures.ts`). That bake is a multi-second GPU job on
the **main thread** → a startup freeze (`'message' handler took ~3000ms` + a ~1 s
first-render shader compile). It's cached per session, so it's a once-per-page-load
freeze, not per-frame.

Pre-computing means: bake **once, offline**, ship the LUTs as a per-body game asset,
and **load** them at runtime (async, browser-cached, no main-thread freeze).

## LUT sizes (what we'd ship / hold in memory)

Per atmospheric body, half-float (RGBA16F):

| Table | Dimensions | Texels | Size |
|---|---|---|---|
| **Scattering (3D)** | 256 × 128 × 32 (ν·μ_s, μ, r) | 1,048,576 | **~8 MB** (dominant) |
| Transmittance (2D) | 256 × 64 | 16,384 | ~128 KB |
| Irradiance (2D) | 64 × 16 | 1,024 | ~8 KB |

≈ **8 MB** GPU memory per body with combined scattering (≈16 MB if single-Mie is a
separate texture, or if stored float32). Compressed on disk (EXR / takram's `.bin`),
the download is roughly **2–4 MB**.

## How (takram already supports this)

- takram ships **`PrecomputedTexturesLoader`** and `<Atmosphere textures="/path">`
  accepts a **URL/string** to pre-baked textures (not just a generated object). So the
  loader path is first-class.
- Slots into the per-body plugin model: ship the LUT next to `atmosphere.json`, e.g.
  `bodies/earth/atmosphere-lut/*` referenced from the manifest; the bridge loads it
  like any other body asset.
- **Earth ≈ takram `DEFAULT`** — for Earth we could even use takram's *own* pre-baked
  default textures and bake nothing. Custom bodies (Mars/Venus/Titan) bake each.

## Offline bake step (the build tool we'd need)

`PrecomputedTexturesGenerator` runs in a GL context, so the offline bake needs a
headless-GL or browser environment that:
1. Constructs `AtmosphereParameters` from the body's `atmosphere.json` `render`
   section (reuse `atmosphereParametersFromRenderConfig`).
2. Runs `generator.update(params)`.
3. Reads back the 3D + 2D render targets and writes them to disk (EXR or a raw `.bin`
   matching `PrecomputedTexturesLoader`'s expected layout).

First check whether takram's repo ships a baking script (it ships pre-baked defaults
for its storybook, so a tool likely exists) before writing our own (~30–50 lines).

## When to do it / trade-offs

- **Trigger:** once the per-body atmosphere `render` params are stable. Pre-baking
  before then means re-baking on every param tweak — friction during tuning.
- **Pro:** removes the startup freeze; async + browser-cached; deterministic; smaller
  than carrying the generator's intermediate render targets.
- **Con:** a ~2–4 MB download per distinct atmosphere; an asset-build step; params are
  baked in (can't tweak live).
- **Scope:** this fixes the **startup bake stall only** — NOT steady-state framerate.
  If the atmosphere is choppy *after* it loads, that's a separate optimization
  (half-res / resolution-scaled atmosphere pass, froxel/LUT-sample tuning).

## Decision

Deferred. Runtime generation (`atmosphereTextures.ts`, with `higherOrderScattering:
false` to trim the bake) stays until the params settle. Revisit pre-compute when (a)
params are locked and (b) the startup freeze is a real UX problem in practice.
