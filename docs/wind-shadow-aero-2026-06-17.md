# GPU "wind shadow" aerodynamics — design note (2026-06-17)

Parked idea to revisit once vehicle meshes are richer. Captures the concept, why
it's the right long-term aero model, the architectural friction with our
worker-isolated physics, and a staged plan.

## The idea

Treat the relative wind like a point/directional light and the craft like an
occluder. The **silhouette** the craft casts on a plane normal to the airflow is
exactly the **projected frontal area** — the `A` in `drag = ½·ρ·v²·Cd·A`. Render
the craft from a camera placed along the relative-wind axis (opposed to the drag
force), orthographic, and:

- **covered area** (lit/occluded pixels × pixel area) = frontal drag area `A`.
- **centroid of the covered region** = center of pressure (CoP), projected back
  onto the body.

GPUs are ideal for this: it's a depth/silhouette render plus a parallel reduction
(sum + first-moment of covered pixels). Same machinery as a shadow map.

## Why it's the correct model (vs. the current scalar per-part dragArea)

Today (`src/sim/vehicle/aggregation.ts`) each part carries a fixed scalar
`dragArea`; the vehicle's drag area is their sum and the CoP is the area-weighted
mean of part positions. That shipped (fixes the staged-capsule terminal-velocity
bug, gives a usable CoP), but it has two fundamental limits the silhouette fixes
for free:

1. **Occlusion.** Stacked parts shadow each other. Summing over-counts; taking the
   max under-counts. The silhouette is the true union frontal area, automatically.
2. **Orientation dependence.** A scalar area is the same nose-on or broadside —
   wrong. The silhouette shrinks nose-first and balloons sideways, so a tumbling
   or re-entering craft catches the right amount of air and gets the right
   restoring torque. This orientation-dependent area + computed CoP is *the* thing
   that makes reentry, tumbling, and passive stability behave. It cannot be
   recovered from a per-part scalar.

It still does **not** give `Cd` (shape / skin friction) — that stays authored or
modeled separately. Wind shadow yields area + CoP only.

## Architectural friction (why it isn't a drop-in)

Our physics is deliberately **headless, in a Web Worker, deterministic, and
unit-tested**. A GPU silhouette challenges all three:

- **No GPU in the worker.** WebGL is on the main thread; the integrator that needs
  the drag area runs in the vehicle worker. So the silhouette must be computed on
  the main thread (which already has the part meshes via `Vessel.tsx`) and shipped
  to the worker — a cross-thread, cross-frame dependency, plus GPU readback stalls
  (`readPixels`/`getBufferSubData` pipeline bubbles).
- **Determinism & testability.** Pixel-counting depends on resolution / MSAA /
  GPU; the force becomes non-deterministic and quantization-jittery, and it can't
  be unit-tested the way the current pure aero functions are.
- **Latency is fine, though.** Aero forces vary slowly relative to a frame, so
  feeding the worker last frame's silhouette (≈1 frame stale) is invisible — the
  worker already consumes per-frame body trajectory curves the same way.

## Proposed integration (when we do it)

Treat the silhouette as **another worker input**, like body curves:

1. Main thread, once per frame (or when the wind-relative attitude changes beyond
   a threshold): set an orthographic camera along the craft's relative-wind axis,
   render the vehicle's silhouette to a small offscreen target.
2. GPU reduction → `{ area, centroidX, centroidY }` (sum and first moments of
   covered texels). Project the centroid back to a body-frame CoP; the area is the
   drag reference area.
3. Post a small struct to the worker; the worker uses it as the current
   `dragArea` + `centerOfPressure` (replacing the part-sum), and the existing
   `(CoP − CoM) × F` torque path is unchanged.

Mitigations: MSAA / sufficient resolution to tame quantization; recompute only on
meaningful attitude-vs-wind change (cache otherwise); clamp/smooth area between
updates to avoid force jitter; keep a deterministic CPU fallback (the scalar
model) for headless/cron runs and tests.

## Staged plan

- **v1 — scalar per-part `dragArea` + area-weighted CoP.** DONE (commit on
  `feat/manuevering`, 2026-06-17). Deterministic, testable, fixed the
  terminal-velocity bug, added the CoP stability torque. Good while craft are a
  handful of primitives.
- **v2 — analytic "wind shadow" in the worker.** Project each part's cross-section
  onto the wind-normal plane and union the areas + centroid (cylinders/cones/boxes
  → ellipses/quads). Gets orientation-dependent drag + computed CoP, still
  deterministic and worker-local, no GPU. **Intentionally skipped for now** — it's
  throwaway once meshes are upgraded, and primitives don't yet justify it.
- **v3 — GPU wind shadow.** The real version, per this note. Do it when vehicles
  become real meshes with many parts and analytic projection gets unwieldy. That
  mesh upgrade is the trigger to revisit this doc.

## Trigger to revisit

When vehicle meshes graduate from primitives to real geometry. At that point the
scalar/analytic models stop being adequate and the GPU silhouette becomes both
necessary and natural (the meshes are already on the GPU for rendering).
