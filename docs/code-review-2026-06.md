# Code Review — June 2026

Cross-subsystem review (state/data-flow, render/performance, simulation/numerical) run
on branch `feat/manuevering` after the attitude-control work. Findings are grouped by
area, severity-ranked, and tagged with status. Items marked **DONE** were fixed in the
same pass that produced this doc; **OPEN** items are tracked here for later.

Severity reflects reviewer judgment after dedup, which in a few cases downgrades an
agent's rating given mitigating context (noted inline).

---

## Correctness

### C1 — Vehicle advance dropped when the worker is busy *(OPEN, high)*
`bridge.ts` `dispatchVehicle` early-returns if `vehicleState !== 'idle'`; when the
orbital worker finishes and dispatches the vehicle while it's still busy, that
`targetTime` is dropped. Not a *permanent* desync (the vehicle worker integrates
straight to the next target), but it produces a larger next step — which feeds C2.
Separately, under sustained load `lastWallTime` resets every frame while `simTime`
only advances on dispatching frames, so wall-time is silently *lost* (sim runs slow).
*Direction:* keep a `pendingVehicleTargetTime` that survives until the worker goes idle;
decide a backpressure policy for the lost wall-time.

### C2 — Angular state integrated in one big step over the whole frame *(OPEN, med — high on paper)*
`vehicle/worker.ts` does a single `integrateOrientation` + `angularVelocityAfterTorque`
over the full `elapsedSeconds`, and thrust direction extrapolates orientation by frozen
ω (`dynamics.ts`). Mitigated because warp >1× zeroes angular velocity, so it only bites
on long frames / the C1 larger-step path. *Direction:* substep or cap the attitude dt;
keep attitude + thrust on the same dt.

### C3 — NaN → infinite-reject hang path *(DONE)*
`pointMassDerivatives` inlined Hermite without the `dt===0` guard the other copies have;
a zero-length body curve → NaN → `errorNorm` NaN → adaptive stepper rejects forever
(`h *= NaN`, which `t + h === t` can't catch) up to `MAX_STEPS`. Fixed both ends:
guarded the hot-path inline (`derivatives.ts`) and added a non-finite-error backstop in
`adaptive.ts`. Covered by new tests in `derivatives.test.ts` and `adaptive.test.ts`.

### C4 — Split sim clock between HUD and 3D scene *(DONE)*
HUD evaluated curves at raw `simTime` while every render component uses interpolated
`getSimTime()`, so telemetry/navball disagreed with ship position at low warp. HUD now
evaluates at the interpolated clock (`HUD.tsx`).

---

## Performance

> `docs/render-performance-followups.md` is largely **resolved** — every High-Priority
> item is done or mitigated. Live items below are second-order.

### P1 — Terrain LOD-4 shell: one-shot 124k-vertex merge + 1536 load promises *(OPEN, med-high)*
`PlanetTerrainTiles.tsx` builds a full `6·16·16` shell per body on first activation —
the single biggest stall. *Direction:* lower `MIN_TILE_LOD` or stream coarse-first.

### P2 — Per-tick store churn re-renders React trees *(OPEN, med)*
`trajectories.ts` clones the whole `curves`/`vehicleControls` objects each worker
message; `Scene.tsx` and `HUD.tsx` subscribe by reference and re-render every physics
tick. *Direction:* drive 3D from `useFrame`+`getState()` (as `Body.tsx` does); throttle
HUD readouts. (Note: C4's HUD fix currently relies on this per-tick re-render — revisit
together.)

### P3 — `useFrame` scratch allocations *(OPEN, med)*
Per-body `Vector3`/tuple/array churn every frame (`Body.tsx`), plus occluder map/filter
chains rebuilt per frame (`VehicleScene.tsx`). *Direction:* pool scratch objects in refs.

### P4 — Layer assignment inside `useFrame` *(OPEN, low-med)*
Includes a recursive subtree walk (`VehicleScene.tsx`). *Direction:* move to effects keyed
on `renderLayer`.

---

## Cleanup

### CL1 — Consolidate duplicated cubic-Hermite curve eval *(DONE)*
`worker.ts` and `dynamics.ts` each carried byte-identical copies of
`sampleCurvePosition`/`sampleCurveVelocity`; both now import `evaluateCurve`/
`evaluateCurveVelocity` from `curves.ts` (the single source). The hot-path inline in
`derivatives.ts` is intentionally kept (allocation-free) but now shares the dt guard.

### CL2 — Remove dead code *(PARTIAL)*
- **DONE:** deleted `orbital/integrator.ts` + its test (Störmer-Verlet integrator the
  production path doesn't use — orbital uses RK45 `advanceTo`), and the zero-reference
  `angularVelocityForRcsKeys` wrapper.
- **KEPT (flagged):** `attitudeHoldTorque` + `pidStep` (`controls.ts`) are unused today,
  but `attitudeHoldTorque` is the full-orientation quaternion hold the roadmap's planned
  `seek-orientation` autopilot will need, and removing it cascades into `pidStep`. Decide
  explicitly when building that feature — and rebuild it on the slew-rate approach
  (`slewAxisTorque`), not the original saturating PD.
- **KEPT (flagged):** `gravityAtPoint` (`orbital/gravity.ts`) and `nBodyDerivatives`
  (`integrator/derivatives.ts`) are referenced only by tests, but those are real gravity
  correctness tests — consolidate the tests onto the production path before removing.

### CL3 — Vec3/quaternion/gravity helpers duplicated across ~6 files *(OPEN, low)*
`add/sub/scale/cross/dot/normalize` re-defined privately in `aero.ts`, `surfaceContact.ts`,
`referenceFrame.ts`, `maneuverNode.ts`, `controls.ts`, `kepler.ts`. *Direction:* extract a
shared `vec3` util (bigger churn; do as its own pass).

### CL4 — Duplicated vehicle type defs *(OPEN, low)*
`VehicleResources/Aero/Engine/Attitude` defined in both `state/vehicle.ts` and
`sim/types.ts`. *Direction:* single source + re-export.
