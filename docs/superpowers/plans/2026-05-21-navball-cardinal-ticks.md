# Navball Cardinal Ticks Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add body-dependent N/E/S/W compass ticks to the navball.

**Architecture:** `navballMath.ts` computes body-local compass vectors from parent-relative position and parent rotation axis, then projects them through the existing craft-local navball projection path. `HUD.tsx` passes the parent rotation axis already used by the reference frame into `NavballCluster`.

**Tech Stack:** TypeScript, React, SVG, Vitest, ESLint, Vite.

---

## File Structure

- Modify `src/ui/navballMath.ts`: add `NavballCompassFrame`, `NavballCompassMarkers`, compass-vector computation, and projected compass markers on `NavballState`.
- Modify `src/ui/__tests__/navball.test.ts`: add tests for equator compass directions, polar/invalid omission, and projected compass markers.
- Modify `src/ui/Navball.tsx`: accept `parentRotationAxis`, pass it to math, and render subtle cardinal tick labels without marker bubbles.
- Modify `src/ui/HUD.tsx`: pass the already computed parent rotation axis into `NavballCluster`.

---

## Chunk 1: Compass Math

### Task 1: Add body-local cardinal vectors

**Files:**
- Modify: `src/ui/navballMath.ts`
- Modify: `src/ui/__tests__/navball.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for a point on the equator using `relativePosition: [1, 0, 0]` and `parentRotationAxis: [0, 1, 0]`:

```ts
const compass = computeNavballCompassFrame({
  relativePosition: [1, 0, 0],
  parentRotationAxis: [0, 1, 0],
})

expect(compass?.north).toEqual([0, 1, 0])
expect(compass?.south).toEqual([0, -1, 0])
expect(compass?.east).toEqual([0, 0, -1])
expect(compass?.west).toEqual([0, 0, 1])
```

Add omission tests:

```ts
expect(computeNavballCompassFrame({ relativePosition: [0, 1, 0], parentRotationAxis: [0, 1, 0] })).toBeNull()
expect(computeNavballCompassFrame({ relativePosition: [0, 0, 0], parentRotationAxis: [0, 1, 0] })).toBeNull()
expect(computeNavballCompassFrame({ relativePosition: [1, 0, 0], parentRotationAxis: [0, 0, 0] })).toBeNull()
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/ui/__tests__/navball.test.ts`

Expected: FAIL because `computeNavballCompassFrame` does not exist.

- [ ] **Step 3: Implement minimal compass frame**

In `src/ui/navballMath.ts`, export:

```ts
export interface NavballCompassFrame {
  north: Vec3
  east: Vec3
  south: Vec3
  west: Vec3
}

export function computeNavballCompassFrame({
  relativePosition,
  parentRotationAxis,
}: {
  relativePosition: Vec3
  parentRotationAxis: Vec3
}): NavballCompassFrame | null {
  const up = normalizeStrict(relativePosition)
  const axis = normalizeStrict(parentRotationAxis)
  if (!up || !axis) return null

  const northProjection = subtract(axis, scale(up, dot(axis, up)))
  const north = normalizeStrict(northProjection)
  if (!north) return null


  const east = normalizeStrict(cross(north, up))
  if (!east) return null


  return {
    north,
    east,
    south: scale(north, -1),
    west: scale(east, -1),
  }
}
```

Add private helpers `subtract()` and `normalizeStrict()` if missing. `normalizeStrict()` must return `null` for zero-length or non-finite inputs and must not use fallback axes.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/ui/__tests__/navball.test.ts`

Expected: PASS.

### Task 2: Project compass markers into navball state

**Files:**
- Modify: `src/ui/navballMath.ts`
- Modify: `src/ui/__tests__/navball.test.ts`

- [ ] **Step 1: Write failing projection test**

Add a `computeNavballState()` test with identity orientation:

```ts
const state = computeNavballState({
  orientation: [0, 0, 0, 1],
  relativePosition: [1, 0, 0],
  relativeVelocity: [0, 0, 1],
  parentRotationAxis: [0, 1, 0],
  radius: 50,
})

expect(state.compass?.north).toMatchObject({ x: 0, y: -50, visible: true })
expect(state.compass?.east.visible).toBe(false)
expect(state.compass?.west).toMatchObject({ x: 0, y: 0, visible: true })
```

Add a test that `state.compass` is `null` at the pole.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- src/ui/__tests__/navball.test.ts`

Expected: FAIL because `computeNavballState()` does not accept `parentRotationAxis` and does not return `compass`.

- [ ] **Step 3: Implement projected compass state**

In `navballMath.ts`:

- Add `NavballCompassMarkers = Record<keyof NavballCompassFrame, ProjectedNavballPoint>`.
- Add `compass: NavballCompassMarkers | null` to `NavballState`.
- Add optional `parentRotationAxis?: Vec3` to `computeNavballState()` input.
- Compute compass only when `parentRotationAxis` is provided.
- Project each compass vector with `worldToCraft()` and `projectNavballVector()`.

Keep existing callers working by making `parentRotationAxis` optional.

- [ ] **Step 4: Run test to verify pass**

Run: `npm test -- src/ui/__tests__/navball.test.ts`

Expected: PASS.

---

## Chunk 2: UI Wiring and Rendering

### Task 3: Pass parent rotation axis to the navball

**Files:**
- Modify: `src/ui/HUD.tsx`
- Modify: `src/ui/Navball.tsx`

- [ ] **Step 1: Wire props without changing the reference-frame API**

Do not add `parentRotationAxis` to `FlightReferenceFrame`. Do not fallback-normalize the compass axis before passing it to the navball; invalid axes must remain invalid so `computeNavballCompassFrame()` can omit ticks.

In `src/ui/Navball.tsx`:

- Add `parentRotationAxis: Vec3` to `NavballProps` and `NavballClusterProps`.
- Pass it into `computeNavballState()`.
- Pass it from `NavballCluster` into `Navball`.

In `src/ui/HUD.tsx`, compute the axis already needed for `computeFlightReferenceFrame()` once and pass that same value into `NavballCluster`:

```ts
const parentRotationAxis = rotationAxisFromAxialTilt(parent.axialTilt)
```

Use that local `parentRotationAxis` both in `computeFlightReferenceFrame()` and pass it directly to the navball:

```tsx
<NavballCluster
  parentRotationAxis={parentRotationAxis}
  // existing props...
/>
```

- [ ] **Step 2: Run tests/typecheck**

Run: `npm test -- src/ui/__tests__/navball.test.ts && npm run typecheck`

Expected: PASS.

### Task 4: Render subtle cardinal ticks

**Files:**
- Modify: `src/ui/Navball.tsx`

- [ ] **Step 1: Render compass labels and ticks**

This project has unit coverage for navball math/projection but no React SVG render-test pattern. Treat this render step as type/build-verified plus browser-smoke/manual visual verification if desired; do not add a new render testing stack just for this small SVG addition.

Inside the clipped navball group, render visible compass points from `state.compass`.

Use perimeter tick-label styling, not marker bubbles:

```tsx
{state.compass && Object.entries(state.compass).map(([key, point]) => {
  if (!point.visible) return null
  const label = key[0].toUpperCase()
  const length = 8
  const magnitude = Math.hypot(point.x, point.y) || 1
  const ux = point.x / magnitude
  const uy = point.y / magnitude
  return (
    <g key={key} opacity="0.72">
      <line
        x1={CENTER + point.x - ux * length}
        y1={CENTER + point.y - uy * length}
        x2={CENTER + point.x}
        y2={CENTER + point.y}
        stroke="rgba(220,235,255,0.65)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <text
        x={CENTER + point.x - ux * (length + 7)}
        y={CENTER + point.y - uy * (length + 7) + 3}
        textAnchor="middle"
        fontFamily="monospace"
        fontSize="7"
        fill="rgba(220,235,255,0.72)"
      >
        {label}
      </text>
    </g>
  )
})}
```

Keep compass rendering less visually prominent than existing prograde/retrograde and normal markers.

- [ ] **Step 2: Run targeted tests**

Run: `npm test -- src/ui/__tests__/navball.test.ts && npm run typecheck`

Expected: PASS.

---

## Chunk 3: Verification

### Task 5: Focused verification

**Files:**
- Verify only; no edits expected.

- [ ] **Step 1: Run tests**

Run: `npm test -- src/ui/__tests__/navball.test.ts src/sim/__tests__/referenceFrame.test.ts src/ui/__tests__/flightReadout.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: pass.

- [ ] **Step 3: Lint touched files**

Run: `npx eslint src/ui/navballMath.ts src/ui/__tests__/navball.test.ts src/ui/Navball.tsx src/ui/HUD.tsx`

Expected: no output and exit 0.

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: build succeeds. Existing large-chunk warning is acceptable.
