# Surface Reference Frame Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch flight telemetry, navball, and vehicle camera semantics to a surface-relative frame for close, body-impacting landing trajectories.

**Architecture:** Add a pure flight reference-frame helper that decides `orbital` vs `surface` from relative state, parent radius/GM/rotation, and surface state. HUD/navball consume the helper output; vehicle camera uses the selected frame to align controls near landing. Debug overlay depth behavior is fixed separately.

**Tech Stack:** TypeScript, React, Three.js, Vitest.

---

## Chunk 1: Reference Frame Helper

### Task 1: Add `src/sim/vehicle/referenceFrame.ts`

- [ ] Write failing tests in `src/sim/__tests__/referenceFrame.test.ts` for: impacting + below `1.1r` selects surface; impacting but high stays orbital; non-impacting low orbit stays orbital; hyperbolic flyby stays orbital; landed/crashed selects surface; surface velocity subtracts rotating surface velocity.
- [ ] Run targeted test and verify it fails.
- [ ] Implement the pure helper.
- [ ] Run targeted test and verify it passes.

## Chunk 2: HUD/Navball Integration

### Task 2: Use helper output in `HUD` and `Navball`

- [ ] Extend navball label to accept `ORBIT NAV` or `SURF NAV` with failing test if practical.
- [ ] Feed surface-relative velocity to flight readout/navball when helper selects surface.
- [ ] Verify targeted UI/math tests.

## Chunk 3: Vehicle Camera And Debug Overlay

### Task 3: Surface-aligned vehicle camera and visible debug axes

- [ ] Adjust vehicle camera control up vector/target semantics for surface mode without changing orbital view.
- [ ] Disable depth testing for craft debug lines/materials so they remain visible against Earth.
- [ ] Run build/typecheck and full tests.
