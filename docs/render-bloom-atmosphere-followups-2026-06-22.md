# Render Follow-ups: Bloom + Atmosphere Shell + Sun HDR (2026-06-22)

Status: **FIXED 2026-07-04** — both symptoms root-caused and fixed. The actual
causes differed from the suspects below; kept for the record with the findings
appended.

## Symptom 1 — Bloom + Earth's atmosphere shell misbehave from a Moon-parented scene

With the vehicle's parent body set to the **Moon**, the **Earth** (nearby, off to
one side) renders as a blown-out white disc with **horizontal banding streaks**
running across/through it.

**Root cause (found by toggling scene objects live):** `AtmosphereGlowMaterial`'s
alpha used `fresnel.remap(0.73, 1, 1, 0).pow(3)` — and TSL `remap` does **not**
clamp. Inward of the limb band (fresnel < 0.73) alpha extrapolates past 1, up to
~3.7 at the shell's centre → ~50 after `pow(3)`. From low orbit the planet's
disc occludes that region so only the sane limb ring shows. From the Moon
(3.9e8 m) the whole shell is ~24 px and the near=1000/far=1e15 depth buffer has
no precision left, so the BackSide shell wins the depth test against the planet
in **bands** — and those alpha≈50 pixels blast through the bloom pass as the
white glare + streaks. Fix: clamp the remap band and fade the glow to zero on
the interior side (`BodyMaterial.tsx`, `buildAtmosphereGlowMaterial`). The limb
glow is unchanged from orbit; the far view now shows a correct small disc (from
the Moon at this epoch: night side + a thin bright refracted ring — the Sun sits
directly behind Earth).

Depth-precision follow-up (not blocking): the orbital canvas could opt into
`reversedDepthBuffer` like the vehicle canvas does, which would fix
depth collapse for any overlapping bodies at range.

## Symptom 2 — Sun looks dull in orbital view (bloom skips it)

**Root cause:** at orbital-view distances the Sun's projected radius (~5.6 px)
falls below `MESH_THRESHOLD_PX = 6`, so `Body` swaps the 40× HDR sun disc
(`SUN_HDR_GAIN`) for the **LDR marker sprite** — nothing HDR is rendered at all,
so bloom has nothing to pick up. It was never a downsample-averaging problem.
Fix: emissive bodies' marker sprites now carry an HDR colour multiplier
(`EMISSIVE_SPRITE_HDR_GAIN = 16`, `Body.tsx` / `OrbitalMarker.tsx`) so the
sprite crosses the 2.0 bloom threshold and out-blooms the brightest stars (~8×).
The stale `RenderPipeline` comment claiming `SUN_HDR_GAIN = 4×` is corrected
(40 is deliberate — see the rationale in `BodyMaterial.tsx`).

## Observation parked while investigating (new)

Lit body surfaces look washed out / milky at full day (e.g. the Moon's day side
from orbit renders near-white with barely visible texture). Not part of these
two symptoms — likely tone-mapping / texture colour-space tuning. Revisit with
the lighting-fidelity work in `docs/realism-inventory-2026-06-17.md`.
