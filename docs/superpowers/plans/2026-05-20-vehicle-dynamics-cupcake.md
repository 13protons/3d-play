# Vehicle Dynamics Cupcake Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default craft feel physically plausible by tying thrust to mass, applying reaction-wheel torque instead of direct angular velocity, and adding PID-controlled nav-frame attitude holds for current attitude and retrograde.

**Architecture:** Keep this as a small first slice inside the existing vehicle worker. Vehicle config gains engine and attitude parameters; controls produce throttle and attitude mode commands; the worker integrates angular velocity from torque and uses a PID controller for hold modes. Translational thrust becomes `maxThrustN * throttle / mass`; fuel burn, wheel saturation, RCS, and aero torque remain deferred.

**Tech Stack:** TypeScript, Vitest, Zustand, Web Workers, existing Hermite trajectory/integrator pipeline.

---

## Chunk 1: Vehicle Model Data

### Task 1: Add engine and attitude config to vehicle model types

**Files:**
- Modify: `src/sim/types.ts`
- Modify: `src/state/vehicle.ts`
- Modify: `src/data/scenarioValidation.ts`
- Test: `src/data/__tests__/scenarioValidation.test.ts`

- [ ] **Step 1: Write failing tests for engine and attitude config validation**

Add a test that accepts:

```ts
engine: { maxThrust: 300_000 }
attitude: {
  momentOfInertia: [12000, 12000, 8000],
  reactionWheelTorque: [8000, 8000, 5000]
}
```

Add rejection cases for non-positive values.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/data/__tests__/scenarioValidation.test.ts`
Expected: FAIL because vehicle validation does not know `engine` or `attitude` yet.

- [ ] **Step 3: Extend types and validator**

Add `VehicleEngine` and `VehicleAttitude` interfaces in `src/sim/types.ts` and `src/state/vehicle.ts`.

Add validator checks:

```ts
engine.maxThrust > 0
attitude.momentOfInertia is 3 positive numbers
attitude.reactionWheelTorque is 3 positive numbers
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/data/__tests__/scenarioValidation.test.ts`
Expected: PASS.

### Task 2: Add realistic default craft values to scenarios

**Files:**
- Modify: `public/data/scenarios/sun-earth-moon.json`
- Modify: `public/data/scenarios/inner-solar-system.json`
- Modify: `public/data/scenarios/full-solar-system.json`
- Test: `src/data/__tests__/scenarioValidation.test.ts`

- [ ] **Step 1: Write failing test that built-in vehicles include engine and attitude configs**

Assert each scenario's `vehicle-1` validates with engine and attitude config.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/data/__tests__/scenarioValidation.test.ts`
Expected: FAIL for missing config.

- [ ] **Step 3: Add scenario values**

Use a small capsule-class default:

```json
"resources": { "dryMass": 9000, "fuelMass": 0 },
"engine": { "maxThrust": 300000 },
"attitude": {
  "momentOfInertia": [12000, 12000, 8000],
  "reactionWheelTorque": [8000, 8000, 5000]
}
```

Keep fuel burn deferred by leaving `fuelMass` static.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/data/__tests__/scenarioValidation.test.ts`
Expected: PASS.

## Chunk 2: Engine Force Uses Mass

### Task 3: Replace hardcoded thrust acceleration with engine force divided by mass

**Files:**
- Modify: `src/sim/vehicle/controls.ts`
- Modify: `src/sim/vehicle/dynamics.ts`
- Modify: `src/sim/vehicle/worker.ts`
- Test: `src/sim/__tests__/vehicleControls.test.ts`
- Test: `src/sim/__tests__/vehicleAeroIntegration.test.ts`

- [ ] **Step 1: Write failing thrust test**

Replace the hardcoded `MAIN_THRUST_ACCELERATION` expectation with a test that `thrustAccelerationForOrientation()` returns `maxThrust / mass` along craft forward at full throttle and half that at `0.5` throttle.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sim/__tests__/vehicleControls.test.ts`
Expected: FAIL because thrust still uses a constant acceleration.

- [ ] **Step 3: Change thrust helper API**

Make thrust helpers accept `{ maxThrust, mass }` or return force direction for dynamics to divide by mass. Prefer minimal change:

```ts
thrustAccelerationForOrientation(orientation, throttle, { maxThrust, mass })
```

Use `0` thrust when resources or engine config is absent.

- [ ] **Step 4: Wire engine config through worker and dynamics**

Pass `engine` alongside `resources` and `aero` from bridge to worker to `vehicleDerivatives()`.

- [ ] **Step 5: Run relevant tests**

Run: `npm test -- src/sim/__tests__/vehicleControls.test.ts src/sim/__tests__/vehicleAeroIntegration.test.ts`
Expected: PASS.

## Chunk 3: Torque-Based Manual Attitude

### Task 4: Convert key input from direct angular velocity to torque command

**Files:**
- Modify: `src/sim/vehicle/controls.ts`
- Modify: `src/sim/vehicle/worker.ts`
- Test: `src/sim/__tests__/vehicleControls.test.ts`

- [ ] **Step 1: Write failing tests for torque integration**

Add tests for a helper like:

```ts
angularVelocityAfterTorque([0, 0, 0], [10, 0, 0], [5, 5, 5], 2) // => [4, 0, 0]
```

Also test opposite key pairs cancel to zero torque.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sim/__tests__/vehicleControls.test.ts`
Expected: FAIL because torque integration does not exist.

- [ ] **Step 3: Implement torque helpers**

Rename or replace `angularVelocityForReactionWheelKeys()` with `reactionWheelTorqueForKeys(keys, reactionWheelTorque)`.

Add:

```ts
angularVelocityAfterTorque(current, torque, momentOfInertia, dt)
```

- [ ] **Step 4: Update worker state**

Store current manual torque command rather than treating `set-attitude` as angular velocity. During each advance, compute angular velocity from torque and elapsed time before integrating orientation.

- [ ] **Step 5: Run tests**

Run: `npm test -- src/sim/__tests__/vehicleControls.test.ts src/sim/__tests__/vehicle-worker.test.ts`
Expected: PASS or update worker tests to assert torque-based behavior.

## Chunk 4: PID Attitude Modes

### Task 5: Add nav-frame attitude targets and PID torque controller

**Files:**
- Modify: `src/sim/types.ts`
- Modify: `src/sim/vehicle/controls.ts`
- Modify: `src/sim/vehicle/worker.ts`
- Modify: `src/state/bridge.ts`
- Test: `src/sim/__tests__/vehicleControls.test.ts`
- Test: `src/sim/__tests__/referenceFrame.test.ts`

- [ ] **Step 1: Write failing PID tests**

Add tests that controller torque decreases as orientation error decreases and applies damping opposite angular velocity. Include a case where proportional-only would overshoot but PD/PID damps.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/sim/__tests__/vehicleControls.test.ts`
Expected: FAIL because attitude controller does not exist.

- [ ] **Step 3: Implement controller**

Implement a bounded PID or PD-with-integral-ready helper:

```ts
attitudeHoldTorque({ currentOrientation, targetOrientation, angularVelocity, gains, maxTorque })
```

Use conservative defaults: proportional term for error axis, derivative term from angular velocity, optional integral term clamped or initially zero. Clamp per-axis torque to reaction wheel limits.

- [ ] **Step 4: Define attitude modes**

Add commands/state for:

```ts
attitudeMode: 'manual' | 'hold-current' | 'retrograde'
```

Manual input switches mode to `manual`.

- [ ] **Step 5: Compute nav-frame targets**

For `hold-current`, capture the craft orientation relative to the active nav frame when enabled; each tick rebuild target world orientation from the current nav frame plus captured relative orientation.

For `retrograde`, build a target orientation whose craft forward axis points opposite active nav-frame velocity. Use the existing `computeFlightReferenceFrame()` decision so surface/orbital mode matches navball behavior.

- [ ] **Step 6: Run tests**

Run: `npm test -- src/sim/__tests__/vehicleControls.test.ts src/sim/__tests__/referenceFrame.test.ts`
Expected: PASS.

## Chunk 5: UI Controls and Readout

### Task 6: Add throttle and attitude mode UI

**Files:**
- Modify: `src/sim/types.ts`
- Modify: `src/ui/HUD.tsx`
- Modify: `src/ui/flightReadout.ts`
- Modify: `src/ui/__tests__/flightReadout.test.ts`

- [ ] **Step 1: Write failing readout tests**

Assert rows include throttle percent, mass, thrust, angular rate, and attitude mode.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/__tests__/flightReadout.test.ts`
Expected: FAIL for missing rows.

- [ ] **Step 3: Add commands and UI**

Keep `Z` throttle toggle, add small throttle step buttons or keys if already present patterns allow it. Add `Hold` and `Retrograde` buttons in HUD with visible active state.

- [ ] **Step 4: Emit control metadata**

Worker `vehicle-controls` should include `attitudeMode`, `mass`, `maxThrust`, and current thrust so HUD can display them without recomputing.

- [ ] **Step 5: Run UI tests**

Run: `npm test -- src/ui/__tests__/flightReadout.test.ts src/ui/__tests__/navball.test.ts`
Expected: PASS.

## Chunk 6: Verification

### Task 7: Full verification

**Files:**
- No new files.

- [ ] **Step 1: Run targeted suites**

Run:

```bash
npm test -- src/sim/__tests__/vehicleControls.test.ts src/sim/__tests__/vehicle-worker.test.ts src/sim/__tests__/vehicleAeroIntegration.test.ts src/ui/__tests__/flightReadout.test.ts src/data/__tests__/scenarioValidation.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run lint for touched files**

Run: `npx eslint <touched files>`
Expected: PASS. If full `npm run check` still fails on unrelated existing lint debt, report that separately with exact errors.
