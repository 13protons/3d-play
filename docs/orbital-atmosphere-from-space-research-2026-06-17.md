# From-space planetary atmosphere — research & design (2026-06-17)

How to render a planet's atmosphere **seen from outside** (orbital view, and the
zoomed-out vehicle view), as a distinct model from takram's in-atmosphere
aerial-perspective. Decision record + recommendation, to review before building.

## Acceptance criterion — the orbital sunrise

We'll know it's right when we can render an ISS-style orbital sunrise: a **thin
blue-white limb** arcing across black space, a **warm orange/red band hugging the
surface at the terminator** (the sunset ring), and the **sun cresting the limb with
a bloom flare**, everything else black. This image decides a design fork: the
asymmetric **blue-limb → red-terminator** gradient is *scattering*, not a halo — a
cheap fresnel/rim glow renders a uniform ring and can't produce it. So the target
mandates the **single-scattering shell** (below), not the fresnel fallback.

Element → what produces it:
- thin blue limb → Rayleigh in-scattering along the grazing shell path;
- red/orange terminator band → long optical path at the day/night edge (blue
  scattered out, red survives) + Mie forward scatter;
- bright sun + flare → our emissive sun disk cresting the limb, fed into bloom;
- black space → the shell returns ~0 inscatter for rays that miss the atmosphere.

## Why a second model

The two viewpoints are different physics problems:

- **Inside the atmosphere** (ground / low flight): you look *through* the air.
  Solved — takram `Sky` + `AerialPerspective`, driven by `worldToECEFMatrix` +
  `sunDirection`, looks great in this regime.
- **From space** (orbital view, zoomed-out vehicle view): you look *at* a planet's
  atmosphere edge-on — a bright **limb glow**, a blue day-side wash, a red sunset
  ring at the terminator, against black space. takram fits this poorly here:
  - It models **one** atmosphere via a single global `worldToECEFMatrix`; the
    orbital view shows the **whole solar system** (Earth, Venus, Mars, Titan, gas
    giants), each wanting its own atmosphere. One-at-a-time doesn't scale.
  - Its aerial-perspective post pass fogs the **background/space** at our scale
    (the maroon-fill bug), and the ground↔space transition hits documented
    floating-point/horizon limits.

So: a **per-planet, localized** atmosphere — exactly the user's instinct — that is
tied to each body's model and only costs where that body is on screen.

## Technique landscape

| Approach | From-space look | Multi-planet | Cost | Notes |
|---|---|---|---|---|
| **Single-scattering shell raymarch** (Nishita / O'Neil GPU Gems 2 ch.16 / Sebastian Lague) | **Best** — true limb glow, terminator, sunset ring | **Natural** (one shell per body) | moderate; cheap *from space* (small screen coverage) + bakeable | physically grounded; driven by `atmosphere.json` |
| Screen-space post pass per planet | good | awkward (per-body masks) | moderate | over-couples to the post pipeline; overkill for many bodies |
| Analytic fresnel / rim glow | decent "glow", **no real terminator/sunset** | natural | cheapest (no march) | fine fallback; reads as a halo, not scattering |

**The from-space case is the easy case for the shell raymarch.** Our v1 shell's
perf problem (60→28 fps) came from the camera being *inside* the shell, filling the
screen with 128-iteration fragments. From orbit the atmosphere covers a small screen
region → few fragments → cheap. (v1 was the *right technique in the wrong place*.)

## Recommendation: per-planet single-scattering shell, with a baked optical-depth LUT

A back-face sphere at `radius + shellHeight` around each atmospheric body, with a
fragment shader that:

1. Intersects the view ray with the shell + the planet (analytic `raySphere`), to
   bound the march and let the planet occlude the far side.
2. Raymarches ~16 samples through the shell; at each sample accumulates Rayleigh +
   Mie in-scattering using transmittance camera→sample and **sample→sun**.
3. Replaces the inner sun-march with a **baked optical-depth LUT** (2D: altitude ×
   sun-zenith-angle) or the analytic Chapman function — turns O(n×m) into O(n), the
   single biggest perf win and what makes it cheap.
4. Composites physically: `result = scene × transmittance + inscatter` (so the
   day-side planet shows through, dims toward the limb, and the limb/terminator
   glow). Rayleigh phase → blue dome; Mie forward phase → sun-side brightening +
   sunset red at grazing terminator.

Why this one:
- It's the **from-space twin of takram's look**, driven by the **same**
  `atmosphere.json` params, so the two models read as one atmosphere across the
  transition.
- **Scales** per body (one shell each), only costs where a body is on screen.
- We have a **starting point**: the removed v1 shell (`AtmosphereShell.tsx` +
  `atmosphereScatter.ts`, in git history before the phase-1 teardown) is ~80% of
  this; the work is the optical-depth LUT + from-space compositing + day/night.
- Fresnel glow stays as a fallback if the march proves too costly with many bodies.

## Where it lives + the swap

- **Orbital view** (`Scene` canvas): always the shell model — the camera is always
  "from space" there. This is the primary home and the cleanest place to build it.
- **Zoomed-out vehicle view**: **swap** on camera altitude. We already compute the
  boolean in `CameraAtmosphereGate` (camera above/below `topRadius`):
  - **below the shell** → takram aerial perspective + Sky (in-atmosphere);
  - **above the shell** → the per-planet limb shell (and takram off).
  Crossfade over a thin altitude band to hide the switch. This is the user's
  "swap between the two atmospheric rendering models."

## Implementation sketch (our stack: R3F 9 / three r0.183 / WebGL2)

- **Shell mesh** per atmospheric body at `radius + shellHeight`, `BackSide`,
  `depthWrite:false`, depth-tested against the planet so the planet occludes the
  near hemisphere; positioned at the body's floating-origin scene position (same
  data as the body mesh); sun direction from the emissive body (same as
  `VehicleSunLight`).
- **Params** from `atmosphere.json`'s `render` section (Rayleigh/Mie coefficients,
  scale heights, shellHeight). Note the unit choice (the section is currently in
  takram per-km units — the shell shader needs consistent per-metre or a documented
  scale; calibrate like the takram mapper).
- **Optical-depth LUT**: a small 2D float texture baked once per distinct param set
  (likely shareable across bodies with the same profile shape, scaled by radius).
- **Compositing**: render after the planet/terrain, before bloom, so the limb feeds
  bloom for the characteristic glow.
- Reuse the postprocessing pipeline already in place; the shell is scene geometry
  (like takram's Sky mesh), not a post effect.

## Open questions / risks

- **Q1 — LUT sharing**: one LUT per body, or one normalized LUT scaled per body?
  (Affects bake cost with many atmospheric bodies.)
- **Q2 — units**: reconcile the shell shader's needs with the takram-native `render`
  section (per-km vs per-m), as with the phase-3 mapper.
- **Q3 — crossfade**: the altitude band + blend so the vehicle-view swap isn't a pop.
- **Q4 — multi-planet perf** in the orbital view: N shells × raymarch; the LUT and
  small screen coverage should keep it cheap, but measure with the full solar system.
- **Q5 — gas giants**: no surface; the shell still works (thick haze), tune params.

## References

- O'Neil, "Accurate Atmospheric Scattering," GPU Gems 2 ch.16 (the canonical
  from-space ground+sky technique): https://developer.nvidia.com/gpugems/gpugems2/part-ii-shading-lighting-and-shadows/chapter-16-accurate-atmospheric-scattering
- Sebastian Lague, "Coding Adventure: Atmosphere" (single-scattering + baked optical
  depth): ShaderToy https://www.shadertoy.com/view/ssXSWs · itch demo https://sebastian.itch.io/atmosphere-experiment
- sinnwrig/URP-Atmosphere — baked-optical-depth port of the Lague approach: https://github.com/sinnwrig/URP-Atmosphere
- jsulpis/realtime-planet-shader — WebGL planet + atmosphere, analytic raycast for
  perf (60fps on low-end mobile): https://github.com/jsulpis/realtime-planet-shader
- three.js forum, atmospheric glow on a sphere (fresnel fallback): https://discourse.threejs.org/t/how-to-create-an-atmospheric-glow-effect-on-surface-of-globe-sphere/32852
