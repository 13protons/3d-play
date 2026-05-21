# Near-Surface Terrain Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a terrain-provider scaffold and near-surface sphere refinement so landed vehicles visually sit on a much smoother spherical surface.

**Architecture:** `src/sim/terrain.ts` becomes the shared surface-query seam, initially returning zero terrain height over the reference sphere. `src/render/lod.ts` owns near-surface mesh-resolution selection. `VehicleScene` consumes the LOD rule, and the simple scenario starts landed on Earth's day side for visual verification.

**Tech Stack:** TypeScript, React Three Fiber, Three.js, Vitest.

---

## Chunk 1: Terrain Query Scaffold

### Task 1: Add zero-height terrain sampling

**Files:**
- Modify: `src/sim/terrain.ts`
- Test: `src/sim/__tests__/terrain.test.ts`

- [ ] Write failing tests for `sampleSphericalTerrain()` returning zero height, radius equal to body radius, and a normalized surface normal.
- [ ] Run `npm test -- src/sim/__tests__/terrain.test.ts` and verify the missing function failure.
- [ ] Implement the minimal zero-height sampling function.
- [ ] Re-run the terrain test and verify it passes.

## Chunk 2: Near-Surface Render LOD

### Task 2: Increase sphere resolution near the surface

**Files:**
- Modify: `src/render/lod.ts`
- Test: `src/render/__tests__/lod.test.ts`
- Modify: `src/render/VehicleScene.tsx`

- [ ] Add failing tests that `sphereSegmentsForVehicleDistance()` returns much higher resolution at landed/near-surface distances while preserving coarse far-body behavior.
- [ ] Run `npm test -- src/render/__tests__/lod.test.ts` and verify the expected failure.
- [ ] Implement altitude-based segment tiers in `sphereSegmentsForVehicleDistance()`.
- [ ] Re-run the LOD test and verify it passes.
- [ ] Keep `VehicleScene` using the same function; only adjust it if the function signature changes.

## Chunk 3: Landed Daylight Scenario

### Task 3: Start the default vehicle landed on Earth's day side

**Files:**
- Modify: `public/data/scenarios/sun-earth-moon.json`
- Test: `src/data/__tests__/scenarioValidation.test.ts`

- [ ] Add or update validation expectations showing the default vehicle is at Earth's reference radius and has no initial orbital velocity relative to the parent.
- [ ] Run `npm test -- src/data/__tests__/scenarioValidation.test.ts` and verify the expectation fails before changing the scenario.
- [ ] Set `vehicle-1` local position to Earth's day-side surface point and velocity to Earth's parent/orbital velocity so surface contact classifies as landed.
- [ ] Re-run scenario validation.

## Chunk 4: Verification

- [ ] Run `npm test -- src/sim/__tests__/terrain.test.ts src/render/__tests__/lod.test.ts src/data/__tests__/scenarioValidation.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Run touched-file eslint for `src/sim/terrain.ts`, `src/render/lod.ts`, and touched tests.
