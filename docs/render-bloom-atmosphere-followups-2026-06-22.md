# Render Follow-ups: Bloom + Atmosphere Shell + Sun HDR (2026-06-22)

Status: **To fix** — captured from the scene editor (`/editor/sun-earth-moon-edit-2`,
parent = Moon, orbital view). Two distinct rendering problems, both in the
orbital-view post/material path. No fix attempted yet; this is a parking note.

## Symptom 1 — Bloom + Earth's atmosphere shell misbehave from a Moon-parented scene

With the vehicle's parent body set to the **Moon**, the **Earth** (nearby, off to
one side) renders as a blown-out white disc with **horizontal banding streaks**
running across/through it. The atmosphere shell appears to be feeding the bloom
pass something it shouldn't — the limb halo / shell brightness is interacting
with the bloom threshold and smearing into hard horizontal lines rather than a
soft glow. Looks worst when a bright lit body sits mid-frame at moderate
distance.

Likely suspects:
- `src/render/AtmosphereShell.tsx` — shell brightness / additive blend may exceed
  the bloom threshold and is not distance- or screen-size-aware.
- `src/render/RenderPipeline.tsx:54` — `bloom(sceneColor, 0.8, 0.8, 2.0)`
  (strength/radius/threshold). The banding smells like the bloom downsample
  pyramid amplifying a thin bright limb ring.
- The limb-halo work from `f3f2e5b feat(sky): stylized atmosphere limb halo from
  altitude` — check whether the halo's HDR value crosses the 2.0 bloom threshold.

## Symptom 2 — Sun looks dull in orbital view (bloom skips it)

In orbital view the **Sun disc** renders dull (small flat orange dot, no glow) —
it isn't reaching the bloom threshold, so it gets no bloom while ordinary lit
bodies / the atmosphere shell *do* (symptom 1). The Sun should be the one thing
that always blooms.

Likely suspects / leads:
- `src/render/BodyMaterial.tsx:49` — `SUN_HDR_GAIN = 40`, applied via
  `material.colorNode = albedo.mul(SUN_HDR_GAIN)` for emissive bodies
  (`BodyMaterial.tsx:124`).
- **Comment/code mismatch** worth chasing: `RenderPipeline.tsx:18-21` documents
  the Sun as `SUN_HDR_GAIN = 4×` and the threshold reasoning around it, but the
  actual constant is `40`. One of them is stale — figure out which value the
  bloom threshold (2.0) was actually tuned against.
- Possible cause: at orbital-view distances the Sun disc is only a few pixels;
  after the bloom downsample its bright pixels may be averaged below threshold,
  so a tiny-but-HDR disc never blooms while a large dim-but-lit body does. May
  need a screen-size floor for the Sun, a dedicated sun-glow sprite, or a
  separate bright-source input to bloom rather than relying on the disc material.

## Notes
- Both reproduce in the scene editor's live preview, which uses the same
  `Scene` / `RenderPipeline withBloom` path as flight (`src/render/Scene.tsx:42`).
- The editor itself is fine — these are pre-existing orbital-view render issues
  surfaced by being able to quickly park the camera near the Moon/Earth.
