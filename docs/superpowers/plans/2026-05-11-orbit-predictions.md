# Orbit Predictions Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace body history trails with orbital-view-only Keplerian prediction rings that recompute every 10 simulated minutes.

**Architecture:** Reuse the existing Kepler sampling math, but update it to accept parent GM directly. Add a focused `OrbitPrediction` renderer that computes body predictions from current curves and renders parent-relative rings. Remove old history/prediction components from scene mounting.

**Tech Stack:** React, React Three Fiber, Three.js, Vitest, TypeScript.

---

## Chunk 1: Prediction Math Uses GM

### Task 1: Convert Kepler element calculation to GM

**Files:**
- Modify: `src/sim/orbital/kepler.ts`
- Test: `src/sim/__tests__/kepler.test.ts`

- [ ] **Step 1: Write failing test for GM-based elements**

Add a test showing `stateToElements()` accepts a parent GM directly and returns that GM in `elements.mu`.

- [ ] **Step 2: Run the focused test**

Run: `npm test -- src/sim/__tests__/kepler.test.ts`

Expected: FAIL until `stateToElements()` accepts GM instead of parent mass.

- [ ] **Step 3: Update implementation**

Change `stateToElements(r, v, parentMass)` to `stateToElements(r, v, parentGm)` and remove `G * parentMass` from the function.

- [ ] **Step 4: Update callers**

Update any remaining `stateToElements()` calls to pass GM.

- [ ] **Step 5: Verify focused test passes**

Run: `npm test -- src/sim/__tests__/kepler.test.ts`

Expected: PASS.

## Chunk 2: Orbit Prediction Renderer

### Task 2: Add `OrbitPrediction`

**Files:**
- Create: `src/render/OrbitPrediction.tsx`
- Test: `src/render/__tests__/orbitPrediction.test.ts`

- [ ] **Step 1: Extract/test cadence helper**

Create a small exported helper such as `shouldRecomputeOrbitPrediction(lastSimTime, currentSimTime, intervalSeconds)` and test that it recomputes at `600` simulated seconds, not before.

- [ ] **Step 2: Run failing cadence test**

Run: `npm test -- src/render/__tests__/orbitPrediction.test.ts`

Expected: FAIL because helper does not exist.

- [ ] **Step 3: Implement helper and renderer**

`OrbitPrediction` should:
- Return `null` for bodies without parents.
- Do nothing while `activeView !== 'orbital'`.
- Reposition its group every frame relative to parent and camera target.
- Recompute points only when no points exist or 600 simulated seconds elapsed.
- Use current parent-relative position/velocity from curves.
- Use parent `gm` from body metadata.
- Render sampled points as a 3px, 70% opacity line with orbit-specific color.
- Add denser samples within 10 degrees of the body's current anomaly.
- Use a per-vertex brightness gradient where the segment behind the body is brighter than the segment ahead.

- [ ] **Step 4: Verify focused test passes**

Run: `npm test -- src/render/__tests__/orbitPrediction.test.ts`

Expected: PASS.

## Chunk 3: Replace History Trails

### Task 3: Mount predictions and remove obsolete renderers

**Files:**
- Modify: `src/render/Scene.tsx`
- Delete: `src/render/OrbitTrace.tsx`
- Delete: `src/render/OrbitLine.tsx`
- Modify: `src/state/trajectories.ts`
- Modify: `src/state/bridge.ts`

- [ ] **Step 1: Add GM to body metadata**

Extend `BodyMeta` with `gm: number` and populate it from body JSON in `startSim()`.

- [ ] **Step 2: Replace scene mounts**

In `Scene.tsx`, replace `OrbitTrace` mounts with `OrbitPrediction` for body IDs only. Do not mount predictions for vehicles.

- [ ] **Step 3: Delete obsolete components**

Remove `OrbitTrace.tsx` and `OrbitLine.tsx` after `Scene.tsx` no longer imports them.

- [ ] **Step 4: Verify no stale imports remain**

Run: `npm run typecheck`

Expected: PASS.

## Chunk 4: Full Verification

### Task 4: Verify behavior and build

**Files:**
- No new files expected.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- src/sim/__tests__/kepler.test.ts src/render/__tests__/orbitPrediction.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Run production build**

Run: `npm run build`

Expected: PASS, allowing the existing Vite chunk-size warning.
