# Unified Navball Instrument Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add throttle/force arc progress bars and moved state/hold/regime indicators to the full `NavballInstrument`, visible in `/_test/hud`.

**Architecture:** Keep `Navball` focused on sphere rendering. Expand `NavballInstrument` into the composed instrument frame that surrounds the sphere with left/right arcs and non-interactive pads. Keep moved telemetry values out of standalone Proximity/Attitude rows and relocate their `lil-gui` controls to the Navball playground section.

**Tech Stack:** React 19, TypeScript, inline SVG/CSS styles, Vitest, `react-dom/server` render tests, `lil-gui` playground controls.

---

## Chunk 1: Arc Math And Instrument Props

### Task 1: Add Arc Geometry Helper

**Files:**
- Create: `src/ui/navballInstrumentMath.ts`
- Create/modify test: `src/ui/__tests__/navballInstrument.test.tsx`

- [ ] **Step 1: Write failing tests for mirrored arc paths**

Test `computeArcProgressPath()` with `value: 0.2`, `radius: 90`, `cx: 95`, `cy: 90`, `startDegrees: 135`, `endDegrees: 45`, and both mirrored/unmirrored arcs. Assert track path starts at the top/bottom expected side and progress path changes endpoint with value.

- [ ] **Step 2: Run red test**

Run: `npm test -- src/ui/__tests__/navballInstrument.test.tsx`
Expected: FAIL because `navballInstrumentMath` does not exist.

- [ ] **Step 3: Implement `navballInstrumentMath.ts`**

Add `degreesToRadians`, `pointOnArc`, `computeArcProgressPath`, and clamp `value` to `0..1`. Use React-compatible path strings only; no JSX in this file.

- [ ] **Step 4: Run green test**

Run: `npm test -- src/ui/__tests__/navballInstrument.test.tsx`
Expected: PASS.

## Chunk 2: Full Navball Instrument Layout

### Task 2: Move Readout Concepts Into `NavballInstrument`

**Files:**
- Modify: `src/ui/Navball.tsx`
- Modify test: `src/ui/__tests__/navballInstrument.test.tsx`

- [ ] **Step 1: Write failing render tests**

Render `NavballInstrument` with `throttle`, `forceRatio`, `surfaceState`, `attitudeMode`, and `regime`. Assert it renders one `ORBITAL`/`SURFACE` label, state/hold pad text, and SVG arc paths.

- [ ] **Step 2: Remove duplicated mode text from tests**

Assert `Navball` no longer renders `ORBIT NAV` or `SURF NAV`, and `NavballInstrument` no longer renders the old top pill text `ORBITAL MODE`/`SURFACE MODE`.

- [ ] **Step 3: Run red test**

Run: `npm test -- src/ui/__tests__/navballInstrument.test.tsx src/ui/__tests__/navball.test.ts`
Expected: FAIL because props/layout are not implemented yet.

- [ ] **Step 4: Implement layout**

Update `NavballInstrument` props to include `throttle`, `forceRatio`, `surfaceState`, and `attitudeMode`. Add a `195px` max instrument frame with the existing `Navball` centered, right throttle arc, left force arc, four non-interactive corner pads, and one regime label. Keep the pads visually present, but only two carry text for now.

- [ ] **Step 5: Run green tests**

Run: `npm test -- src/ui/__tests__/navballInstrument.test.tsx src/ui/__tests__/navball.test.ts`
Expected: PASS.

## Chunk 3: Playground Rewiring

### Task 3: Update `/_test/hud` Controls And Panels

**Files:**
- Modify: `src/ui/HudTestPage.tsx`
- Modify test if needed: `src/ui/__tests__/flightReadout.test.ts`

- [ ] **Step 1: Move controls into Navball config**

Move `surfaceState`, `attitudeMode`, `throttle`, and `thrustNewtons` controls into `configureNavballControls()`.

- [ ] **Step 2: Clean standalone panels**

Remove `surfaceState` controls from Proximity controls. Remove `throttle`, `thrustNewtons`, and `attitudeMode` controls from Attitude controls.

- [ ] **Step 3: Pass new props to `NavballInstrument`**

Use `throttle={params.throttle}` and `forceRatio={params.thrustNewtons / 1_000_000}` or equivalent normalized force for first slice. Pass `surfaceState` and `attitudeMode` directly.

- [ ] **Step 4: Verify**

Run: `npm test -- src/ui/__tests__/navballInstrument.test.tsx src/ui/__tests__/flightReadout.test.ts src/ui/__tests__/navball.test.ts`
Run: `npm run typecheck`
Run: `npx eslint src/ui/Navball.tsx src/ui/HudTestPage.tsx src/ui/navballInstrumentMath.ts src/ui/__tests__/navballInstrument.test.tsx`
Run: `git diff --check`
Expected: all pass / clean.
