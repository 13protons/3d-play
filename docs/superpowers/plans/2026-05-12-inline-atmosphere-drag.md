# Inline Atmosphere Drag Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add data-driven inline Earth atmosphere and a synchronous aerodynamic force-provider API consumed by the vehicle worker.

**Architecture:** Keep atmosphere metadata on body JSON, vehicle mass/aero ownership on vehicle scenario data and `src/state/vehicle.ts`, and aerodynamic force solving as a pure module called by the vehicle worker during integration. Do not add a dedicated aero worker or message bus.

**Tech Stack:** TypeScript, Vitest, Vite web workers, Zustand.

---

## Chunk 1: Data Shapes And Validation

### Task 1: Add atmosphere/resource/aero validation

**Files:**
- Modify: `src/data/scenarioValidation.ts`
- Modify: `src/data/__tests__/scenarioValidation.test.ts`
- Modify: `public/data/bodies/earth.json`
- Modify: `public/data/scenarios/sun-earth-moon.json`

- [ ] Add failing tests that Earth accepts inline exponential atmosphere and malformed atmosphere/aero/resources are rejected by exported validators.
- [ ] Run `npm test -- src/data/__tests__/scenarioValidation.test.ts` and verify failure.
- [ ] Implement exported validation helpers for `InlineAtmosphere`, `VehicleResources`, and `VehicleAero`.
- [ ] Add Earth atmosphere data and vehicle resources/aero to the scenario vehicle.
- [ ] Re-run targeted tests.

## Chunk 2: Vehicle Resources Store

### Task 2: Implement vehicle resources state

**Files:**
- Modify: `src/state/vehicle.ts`
- Create: `src/state/__tests__/vehicle.test.ts`
- Modify: `src/state/bridge.ts`

- [ ] Add failing tests for mass calculation and vehicle resource/aero initialization.
- [ ] Run targeted test and verify failure.
- [ ] Implement a small Zustand store with `setVehicleModel`, `reset`, and computed `mass`.
- [ ] Initialize the store from scenario vehicles in `bridge.ts`.
- [ ] Re-run targeted tests.

## Chunk 3: Aerodynamic Force Provider

### Task 3: Add synchronous aero force provider

**Files:**
- Create: `src/sim/vehicle/aero.ts`
- Create: `src/sim/__tests__/aero.test.ts`

- [ ] Add failing tests for exponential density, zero force cases, drag direction, co-rotation velocity, and activation radius.
- [ ] Run `npm test -- src/sim/__tests__/aero.test.ts` and verify failure.
- [ ] Implement `computeAeroForce(input): AeroForceOutput` with SI units, `+Z` forward body convention, zero torque, no wind, finite safeguards.
- [ ] Re-run targeted tests.

## Chunk 4: Vehicle Worker Integration

### Task 4: Apply aero force during vehicle integration

**Files:**
- Modify: `src/sim/types.ts`
- Modify: `src/state/bridge.ts`
- Modify: `src/sim/vehicle/worker.ts`
- Create/modify: `src/sim/__tests__/vehicleAeroIntegration.test.ts`

- [ ] Add a failing integration test proving a low Earth vehicle loses orbital energy with atmosphere active.
- [ ] Run targeted test and verify failure.
- [ ] Extend vehicle worker init with resources, aero, and body atmosphere/surface metadata.
- [ ] Call `computeAeroForce` inside the vehicle derivative using the current state and parent curve sample.
- [ ] Re-run targeted tests.

## Chunk 5: Verification

### Task 5: Full verification

**Files:**
- All changed files

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Fix any failures with TDD regression tests first.
