# Orbit Summary HUD Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add periapsis, apoapsis, and open/closed/impacting orbit state to the navball telemetry rows.

**Architecture:** `computeFlightReferenceFrame()` becomes the single source of truth for both reference mode and orbit summary. The HUD passes that summary into existing flight telemetry row formatting, so displayed orbital values cannot drift from mode classification.

**Tech Stack:** TypeScript, React, Zustand state stores, Vitest, ESLint, Vite.

---

## File Structure

- Modify `src/sim/vehicle/referenceFrame.ts`: add `OrbitKind` and `OrbitSummary`, compute orbit summary, return it on `FlightReferenceFrame`, and gate mode using `orbit.kind`.
- Modify `src/sim/__tests__/referenceFrame.test.ts`: add TDD coverage for closed, open, bound-impact, and hyperbolic-impact summaries.
- Modify `src/ui/flightReadout.ts`: add orbit row formatting to `flightTelemetryRows()`.
- Modify `src/ui/__tests__/flightReadout.test.ts`: add row-format tests for closed and open/impact summaries.
- Modify `src/ui/HUD.tsx`: pass `flightReadout.frame.orbit` into `flightTelemetryRows()`.

---

## Chunk 1: Reference Frame Orbit Summary

### Task 1: Add closed orbit summary

**Files:**
- Modify: `src/sim/__tests__/referenceFrame.test.ts`
- Modify: `src/sim/vehicle/referenceFrame.ts`

- [ ] **Step 1: Write the failing test**

Add this expectation to the existing low circular orbit test:

```ts
expect(result.orbit.kind).toBe('closed')
expect(result.orbit.periapsisAltitude).toBeCloseTo(100_000)
expect(result.orbit.apoapsisAltitude).toBeCloseTo(100_000)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sim/__tests__/referenceFrame.test.ts`

Expected: FAIL because `result.orbit` does not exist.

- [ ] **Step 3: Add minimal orbit summary implementation**

In `src/sim/vehicle/referenceFrame.ts`, add:

```ts
export type OrbitKind = 'closed' | 'open' | 'impacting'

export interface OrbitSummary {
  kind: OrbitKind
  periapsisAltitude: number
  apoapsisAltitude: number | null
}
```

Add `orbit: OrbitSummary` to `FlightReferenceFrame`.

Replace the boolean helper with a summary helper:

```ts
function computeOrbitSummary({
  relativePosition,
  relativeVelocity,
  parentGm,
  parentRadius,
}: {
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentGm: number
  parentRadius: number
}): OrbitSummary {
  const r = magnitude(relativePosition)
  if (r <= 0 || parentGm <= 0) {
    return { kind: 'open', periapsisAltitude: Infinity, apoapsisAltitude: null }
  }

  const v2 = dot(relativeVelocity, relativeVelocity)
  const specificEnergy = v2 / 2 - parentGm / r
  const h = cross(relativePosition, relativeVelocity)
  const h2 = dot(h, h)
  const eccentricitySquared = Math.max(0, 1 + (2 * specificEnergy * h2) / (parentGm * parentGm))
  const eccentricity = Math.sqrt(eccentricitySquared)
  const periapsisRadius = h2 / (parentGm * (1 + eccentricity))
  const apoapsisRadius = specificEnergy < 0
    ? h2 / (parentGm * Math.max(1 - eccentricity, 1e-12))
    : null
  const periapsisAltitude = periapsisRadius - parentRadius
  const apoapsisAltitude = apoapsisRadius === null ? null : apoapsisRadius - parentRadius

  return {
    kind: periapsisRadius <= parentRadius ? 'impacting' : specificEnergy < 0 ? 'closed' : 'open',
    periapsisAltitude,
    apoapsisAltitude,
  }
}
```

In `computeFlightReferenceFrame()`, compute `const orbit = computeOrbitSummary(...)`, set mode from `orbit.kind`, and return `orbit`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/sim/__tests__/referenceFrame.test.ts`

Expected: PASS.

### Task 2: Cover open and impacting summaries

**Files:**
- Modify: `src/sim/__tests__/referenceFrame.test.ts`
- Modify: `src/sim/vehicle/referenceFrame.ts` only if tests expose a bug

- [ ] **Step 1: Add failing or expanding tests**

Add expectations to existing tests:

```ts
expect(result.orbit.kind).toBe('open')
expect(result.orbit.periapsisAltitude).toBeGreaterThan(0)
expect(result.orbit.apoapsisAltitude).toBeNull()
```

for the hyperbolic flyby test.

Add expectations to the hyperbolic impact test:

```ts
expect(result.orbit.kind).toBe('impacting')
expect(result.orbit.periapsisAltitude).toBeLessThanOrEqual(0)
expect(result.orbit.apoapsisAltitude).toBeNull()
```

Add or update a bound impact test with an available apoapsis:

```ts
expect(result.orbit.kind).toBe('impacting')
expect(result.orbit.periapsisAltitude).toBeLessThanOrEqual(0)
expect(result.orbit.apoapsisAltitude).not.toBeNull()
```

- [ ] **Step 2: Run tests**

Run: `npm test -- src/sim/__tests__/referenceFrame.test.ts`

Expected: PASS after Task 1, or fail with a specific orbital math issue to fix minimally.

- [ ] **Step 3: Fix only if needed**

If apoapsis is unstable for circular orbits, adjust only the apoapsis radius calculation. Do not add extra orbital elements.

- [ ] **Step 4: Run tests again**

Run: `npm test -- src/sim/__tests__/referenceFrame.test.ts`

Expected: PASS.

---

## Chunk 2: HUD Telemetry Rows

### Task 3: Format orbit rows

**Files:**
- Modify: `src/ui/flightReadout.ts`
- Modify: `src/ui/__tests__/flightReadout.test.ts`

- [ ] **Step 1: Write failing row-format tests**

Add a test that passes an orbit summary into `flightTelemetryRows()` and expects rows with labels `ORB`, `PE`, and `AP`.

Use a closed summary:

```ts
orbit: {
  kind: 'closed',
  periapsisAltitude: 100_000,
  apoapsisAltitude: 250_000,
}
```

Expected row values include `CLOSED`, `100.0 km`, and `250.0 km` or the current project formatter equivalent.

Add a second case for an open summary where `AP` is `--`.

Add a third case for an impacting summary where `ORB` is `IMPACT`, not `IMPACTING`.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- src/ui/__tests__/flightReadout.test.ts`

Expected: FAIL because `flightTelemetryRows()` does not accept or render orbit rows yet.

- [ ] **Step 3: Implement row formatting**

Update the `flightTelemetryRows()` input type to accept `orbit?: OrbitSummary` imported as a type from `src/sim/vehicle/referenceFrame.ts`.

Append rows only when `orbit` exists:

```ts
const orbitLabel = orbit.kind === 'impacting' ? 'IMPACT' : orbit.kind.toUpperCase()

...(orbit ? [
  { label: 'ORB', value: orbitLabel },
  { label: 'PE', value: formatFlightNumber(orbit.periapsisAltitude, 'm') },
  { label: 'AP', value: orbit.apoapsisAltitude === null ? '--' : formatFlightNumber(orbit.apoapsisAltitude, 'm') },
] : [])
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- src/ui/__tests__/flightReadout.test.ts`

Expected: PASS.

### Task 4: Wire HUD to navball rows

**Files:**
- Modify: `src/ui/HUD.tsx`

- [ ] **Step 1: Pass orbit summary into telemetry rows**

In the `flightTelemetryRows()` call, add:

```ts
orbit: flightReadout.frame.orbit,
```

- [ ] **Step 2: Run relevant tests**

Run: `npm test -- src/sim/__tests__/referenceFrame.test.ts src/ui/__tests__/flightReadout.test.ts`

Expected: PASS.

---

## Chunk 3: Verification

### Task 5: Full focused verification

**Files:**
- Verify only; no edits expected.

- [ ] **Step 1: Run targeted tests**

Run: `npm test -- src/sim/__tests__/referenceFrame.test.ts src/ui/__tests__/flightReadout.test.ts src/render/__tests__/surfacePatch.test.ts src/render/__tests__/cameraSmoothing.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: pass.

- [ ] **Step 3: Lint touched files**

Run: `npx eslint src/sim/vehicle/referenceFrame.ts src/sim/__tests__/referenceFrame.test.ts src/ui/flightReadout.ts src/ui/__tests__/flightReadout.test.ts src/ui/HUD.tsx`

Expected: no output and exit 0.

- [ ] **Step 4: Build**

Run: `npm run build`

Expected: build succeeds. Existing large-chunk warning is acceptable.
