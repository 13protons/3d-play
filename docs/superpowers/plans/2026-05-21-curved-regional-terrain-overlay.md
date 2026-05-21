# Curved Regional Terrain Overlay Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat local surface patch with a curved, textured regional overlay derived from the same spherical body texture mapping as the base planet.

**Architecture:** Add a pure geometry builder that creates a spherical cap around the vehicle radial direction with equirectangular UVs. Render that geometry in the terrain overlay layer using the parent body's existing `BodyMaterial` path.

**Tech Stack:** React Three Fiber, Three.js BufferGeometry, Vitest, TypeScript.

---

## Chunk 1: Curved Overlay Geometry

### Task 1: Geometry Builder

**Files:**
- Create: `src/render/surfaceOverlayGeometry.ts`
- Test: `src/render/__tests__/surfaceOverlayGeometry.test.ts`

- [ ] Write failing tests for vertex radius, center direction, UV bounds, and index count.
- [ ] Implement `createSphericalCapOverlayGeometryData()` returning typed arrays for positions, normals, uvs, and indices.
- [ ] Use equirectangular UV mapping from normalized direction.
- [ ] Run `npm test -- src/render/__tests__/surfaceOverlayGeometry.test.ts`.

### Task 2: Vehicle Scene Overlay Render

**Files:**
- Modify: `src/render/VehicleScene.tsx`

- [ ] Replace `planeGeometry` in `VehicleSurfacePatch` with generated `bufferGeometry`.
- [ ] Center the overlay on `vehicleRadialOut()`.
- [ ] Use parent body radius and texture/material via `BodyMaterial`.
- [ ] Keep overlay on `RENDER_LAYERS.terrainOverlay`.

### Task 3: Verification

**Files:**
- Test: `src/render/__tests__/surfaceOverlayGeometry.test.ts`
- Test: existing render and terrain tests.

- [ ] Run targeted render/terrain tests.
- [ ] Run `npm run typecheck`.
- [ ] Run ESLint on touched files.
- [ ] Run `npm run build`.
- [ ] Smoke test vehicle view in browser.
