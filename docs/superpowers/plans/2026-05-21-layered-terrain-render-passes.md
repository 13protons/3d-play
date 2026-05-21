# Layered Terrain Render Passes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the global body sphere and local terrain overlay in separate Three.js layer passes so local terrain never cuts to black space.

**Architecture:** Add small render-layer helpers, configure the R3F Canvas with `frameloop="never"`, and drive rendering from one pass controller that selects camera layers and clears depth between base and overlay passes. Keep one scene and one camera.

**Tech Stack:** React Three Fiber, Three.js `Layers`, Vitest, TypeScript.

---

## Chunk 1: Layer Helpers and Pass Controller

### Task 1: Render Layer Helpers

**Files:**
- Create: `src/render/renderLayers.ts`
- Test: `src/render/__tests__/renderLayers.test.ts`

- [ ] Write failing tests for numeric layer IDs and ordered pass names.
- [ ] Implement `RENDER_LAYERS` and `TERRAIN_RENDER_PASSES`.
- [ ] Run `npm test -- src/render/__tests__/renderLayers.test.ts`.

### Task 2: Vehicle Scene Pass Wiring

**Files:**
- Modify: `src/render/VehicleScene.tsx`

- [ ] Add a `VehicleSceneRenderPasses` component using `useFrame(..., 1)`.
- [ ] Render base layer, call `gl.clearDepth()`, render terrain layer, then render vehicle layer.
- [ ] Set `frameloop="never"` on `Canvas` so the default R3F render does not also render all layers.
- [ ] Assign body meshes to the base layer, surface patch to terrain layer, and vehicle/debug meshes to the vehicle layer.
- [ ] Keep the existing local patch thresholds initially; the layer pass should make the base sphere available underneath terrain.

### Task 3: Verification

**Files:**
- Test: `src/render/__tests__/renderLayers.test.ts`
- Test: `src/render/__tests__/surfacePatch.test.ts`

- [ ] Run `npm test -- src/render/__tests__/renderLayers.test.ts src/render/__tests__/surfacePatch.test.ts src/render/__tests__/cameraSmoothing.test.ts src/data/__tests__/scenarioValidation.test.ts src/sim/__tests__/terrain.test.ts src/render/__tests__/lod.test.ts`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npx eslint "src/render/VehicleScene.tsx" "src/render/renderLayers.ts" "src/render/__tests__/renderLayers.test.ts"`.
