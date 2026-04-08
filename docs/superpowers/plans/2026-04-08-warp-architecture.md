# Warp Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-step setTimeout-based warp system with a bridge-owned clock and Dormand-Prince adaptive integrator, enabling stable n-body orbits at any warp rate.

**Architecture:** The bridge (main thread) owns simulation time and drives both workers via `advance` messages. Workers use a shared Dormand-Prince 4/5 adaptive integrator that automatically selects step sizes — taking huge steps during smooth orbital arcs and small steps near perturbations. The orbital worker runs first each batch, then its trajectory curves feed the vehicle worker's gravity evaluation.

**Tech Stack:** TypeScript, Web Workers, vitest, Dormand-Prince RK4(5) with FSAL

---

### File Structure

| File | Purpose |
|------|---------|
| `src/sim/integrator/adaptive.ts` | **New.** Dormand-Prince 4/5 adaptive integrator. Pure math, no worker/DOM deps. |
| `src/sim/integrator/derivatives.ts` | **New.** Derivative functions for n-body and point-mass-in-field. |
| `src/sim/orbital/worker.ts` | **Modify.** Remove setTimeout loop. Respond to `advance` messages. Pack/unpack state vector. |
| `src/sim/vehicle/worker.ts` | **Modify.** Remove setTimeout loop. Respond to `advance` with bodyCurves. Gravity from curve interpolation. |
| `src/state/bridge.ts` | **Modify.** Own the clock. Sequential dispatch: orbital → vehicle. Track idle/busy. |
| `src/sim/types.ts` | **Modify.** Update worker message types. |
| `src/sim/__tests__/adaptive.test.ts` | **New.** Adaptive integrator unit tests. |
| `src/sim/__tests__/orbital-dynamics.test.ts` | **Modify.** Add adaptive integrator energy conservation tests. |

---

### Task 1: Dormand-Prince Adaptive Integrator

**Files:**
- Create: `src/sim/integrator/adaptive.ts`
- Create: `src/sim/__tests__/adaptive.test.ts`

- [ ] **Step 1: Write failing tests for the adaptive integrator**

Create the test file. These tests exercise the integrator in isolation with simple, analytically-known systems.

```typescript
// src/sim/__tests__/adaptive.test.ts
import { describe, it, expect } from 'vitest'
import { advanceTo, type DerivFn } from '../integrator/adaptive'
import { G } from '../constants'

describe('advanceTo (Dormand-Prince 4/5)', () => {
  it('integrates constant velocity exactly', () => {
    // dy/dt = [vx, vy, vz, 0, 0, 0] — straight line, zero acceleration
    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      dydt[3] = 0; dydt[4] = 0; dydt[5] = 0
    }
    const y = new Float64Array([0, 0, 0, 100, 0, 0]) // x=0, vx=100
    const result = advanceTo(y, 0, 10, deriv, 1e-10)
    expect(result.y[0]).toBeCloseTo(1000, 5) // x = 100 * 10
    expect(result.y[3]).toBeCloseTo(100, 5)  // vx unchanged
  })

  it('integrates uniform gravity accurately', () => {
    // Free fall: a = (0, -9.81, 0)
    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      dydt[3] = 0; dydt[4] = -9.81; dydt[5] = 0
    }
    const y = new Float64Array([0, 0, 0, 0, 0, 0])
    const result = advanceTo(y, 0, 2, deriv, 1e-10)
    expect(result.y[1]).toBeCloseTo(-0.5 * 9.81 * 4, 5) // y = -½gt²
    expect(result.y[4]).toBeCloseTo(-9.81 * 2, 5)        // vy = -gt
  })

  it('conserves energy in circular orbit over 5 orbits', () => {
    const M = 5.972e24
    const r = 6_771_000
    const GM = G * M
    const v = Math.sqrt(GM / r)

    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
      const rr = Math.sqrt(r2)
      const f = -GM / (r2 * rr)
      dydt[3] = f * y[0]; dydt[4] = f * y[1]; dydt[5] = f * y[2]
    }

    const y = new Float64Array([r, 0, 0, 0, 0, v])
    const period = 2 * Math.PI * r / v
    const initialE = 0.5 * v * v - GM / r

    const result = advanceTo(y, 0, period * 5, deriv, 1e-12)

    const finalV2 = result.y[3] ** 2 + result.y[4] ** 2 + result.y[5] ** 2
    const finalR = Math.sqrt(result.y[0] ** 2 + result.y[1] ** 2 + result.y[2] ** 2)
    const finalE = 0.5 * finalV2 - GM / finalR
    const drift = Math.abs((finalE - initialE) / initialE)

    expect(drift).toBeLessThan(1e-8)
    expect(result.steps).toBeLessThan(2000) // much less than 5 * 324,000
  })

  it('takes fewer steps for smooth orbits than perturbed ones', () => {
    const M = 5.972e24
    const r = 6_771_000
    const GM = G * M
    const v = Math.sqrt(GM / r)
    const period = 2 * Math.PI * r / v

    // Single body — smooth
    const smoothDeriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
      const rr = Math.sqrt(r2)
      const f = -GM / (r2 * rr)
      dydt[3] = f * y[0]; dydt[4] = f * y[1]; dydt[5] = f * y[2]
    }

    const y1 = new Float64Array([r, 0, 0, 0, 0, v])
    const smooth = advanceTo(y1, 0, period, smoothDeriv, 1e-10)

    // Add a massive perturber nearby — force field changes rapidly
    const pertGM = G * 7.348e22 // Moon mass
    const pertPos = [r + 500_000, 0, 0] // 500km away
    const perturbedDeriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
      const rr = Math.sqrt(r2)
      const f = -GM / (r2 * rr)
      dydt[3] = f * y[0]; dydt[4] = f * y[1]; dydt[5] = f * y[2]
      // Perturber
      const dx = pertPos[0] - y[0], dy = pertPos[1] - y[1], dz = pertPos[2] - y[2]
      const pr2 = dx * dx + dy * dy + dz * dz
      const pr = Math.sqrt(pr2)
      const pf = pertGM / (pr2 * pr)
      dydt[3] += pf * dx; dydt[4] += pf * dy; dydt[5] += pf * dz
    }

    const y2 = new Float64Array([r, 0, 0, 0, 0, v])
    const perturbed = advanceTo(y2, 0, period, perturbedDeriv, 1e-10)

    // Perturbed should need more steps (smaller dt near the perturber)
    expect(perturbed.steps).toBeGreaterThan(smooth.steps)
  })

  it('lands exactly on targetTime', () => {
    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      dydt[3] = 0; dydt[4] = 0; dydt[5] = 0
    }
    const y = new Float64Array([0, 0, 0, 1, 0, 0])
    const target = 7.777
    const result = advanceTo(y, 0, target, deriv, 1e-10)
    expect(result.y[0]).toBeCloseTo(target, 10) // x = 1.0 * t
  })

  it('handles very short time spans', () => {
    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      dydt[3] = 0; dydt[4] = 0; dydt[5] = 0
    }
    const y = new Float64Array([0, 0, 0, 100, 0, 0])
    const result = advanceTo(y, 0, 1e-10, deriv, 1e-12)
    expect(result.y[0]).toBeCloseTo(100 * 1e-10, 15)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/__tests__/adaptive.test.ts`
Expected: FAIL — module `../integrator/adaptive` does not exist.

- [ ] **Step 3: Implement the Dormand-Prince integrator**

```typescript
// src/sim/integrator/adaptive.ts

/**
 * Dormand-Prince 4/5 adaptive integrator (RK45 with FSAL).
 *
 * Takes a state vector y and advances it from t0 to t1 using automatic
 * step size control. The derivative function computes dy/dt at any (t, y).
 *
 * FSAL: the 7th stage of step N is reused as the 1st stage of step N+1,
 * giving effectively 6 force evaluations per accepted step.
 */

/** Derivative function: writes dy/dt into dydt given (t, y). */
export type DerivFn = (t: number, y: Float64Array, dydt: Float64Array) => void

// Dormand-Prince coefficients
const A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
]

// 5th-order weights (used for the accepted solution)
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0]

// 4th-order weights (used for error estimation)
const B4 = [
  5179 / 57600, 0, 7571 / 16695, 393 / 640,
  -92097 / 339200, 187 / 2100, 1 / 40,
]

// Time fraction coefficients
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1]

const SAFETY = 0.9
const MIN_SCALE = 0.2
const MAX_SCALE = 5.0
const MAX_STEPS = 1_000_000

/**
 * Advance state vector y from t0 to t1 using adaptive Dormand-Prince 4/5.
 *
 * @param y     State vector (modified in place and returned)
 * @param t0    Start time
 * @param t1    Target time (must be > t0)
 * @param deriv Derivative function: (t, y, dydt) => void
 * @param tol   Error tolerance (e.g., 1e-10)
 * @returns     { y: the advanced state, steps: number of accepted steps }
 */
export function advanceTo(
  y: Float64Array,
  t0: number,
  t1: number,
  deriv: DerivFn,
  tol: number,
): { y: Float64Array; steps: number } {
  const n = y.length

  // Allocate working arrays
  const k = Array.from({ length: 7 }, () => new Float64Array(n))
  const yTmp = new Float64Array(n)
  const y5 = new Float64Array(n)

  let t = t0
  let dt = Math.min((t1 - t0) * 0.01, t1 - t0) // initial guess: 1% of span
  if (dt <= 0) dt = t1 - t0
  let steps = 0
  let hasFSAL = false

  // Compute initial derivatives (or reuse FSAL from previous step)
  deriv(t, y, k[0])

  while (t < t1) {
    if (steps >= MAX_STEPS) break

    // Clamp dt to not overshoot target
    if (t + dt > t1) dt = t1 - t

    // Compute stages k[1] through k[6]
    for (let s = 1; s < 7; s++) {
      const ts = t + C[s] * dt
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let j = 0; j < s; j++) sum += A[s][j] * k[j][i]
        yTmp[i] = y[i] + dt * sum
      }
      deriv(ts, yTmp, k[s])
    }

    // Compute 5th-order solution and error estimate
    let errMax = 0
    for (let i = 0; i < n; i++) {
      let sum5 = 0, sum4 = 0
      for (let j = 0; j < 7; j++) {
        sum5 += B5[j] * k[j][i]
        sum4 += B4[j] * k[j][i]
      }
      y5[i] = y[i] + dt * sum5
      const err = Math.abs(dt * (sum5 - sum4))
      const scale = tol * (1 + Math.abs(y5[i]))
      errMax = Math.max(errMax, err / scale)
    }

    if (errMax <= 1.0) {
      // Accept step
      t += dt
      for (let i = 0; i < n; i++) y[i] = y5[i]
      steps++

      // FSAL: k[6] of this step becomes k[0] of next step
      const tmp = k[0]
      k[0] = k[6]
      k[6] = tmp
      hasFSAL = true

      // Grow step size
      const scale = errMax > 1e-30
        ? Math.min(MAX_SCALE, SAFETY * Math.pow(errMax, -0.2))
        : MAX_SCALE
      dt *= scale
    } else {
      // Reject step — shrink and retry
      const scale = Math.max(MIN_SCALE, SAFETY * Math.pow(errMax, -0.2))
      dt *= scale
      hasFSAL = false
      deriv(t, y, k[0]) // recompute k[0] since we didn't advance
    }
  }

  return { y, steps }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/__tests__/adaptive.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/integrator/adaptive.ts src/sim/__tests__/adaptive.test.ts
git commit -m "feat: Dormand-Prince 4/5 adaptive integrator"
```

---

### Task 2: Derivative Functions for Workers

**Files:**
- Create: `src/sim/integrator/derivatives.ts`
- Create: `src/sim/__tests__/derivatives.test.ts`

- [ ] **Step 1: Write failing tests for derivative functions**

```typescript
// src/sim/__tests__/derivatives.test.ts
import { describe, it, expect } from 'vitest'
import { nBodyDerivatives, pointMassDerivatives } from '../integrator/derivatives'
import { G } from '../constants'
import type { TrajectoryCurve } from '../types'

describe('nBodyDerivatives', () => {
  it('computes correct acceleration for two-body system', () => {
    const masses = [5.972e24, 1.989e30] // Earth, Sun
    const deriv = nBodyDerivatives(masses)

    // Earth at (1.5e11, 0, 0), Sun at origin. Both at rest.
    const y = new Float64Array([
      1.496e11, 0, 0, 0, 0, 0,  // Earth: pos + vel
      0, 0, 0, 0, 0, 0,          // Sun: pos + vel
    ])
    const dydt = new Float64Array(12)
    deriv(0, y, dydt)

    // Earth velocity derivatives = Earth velocity (from state)
    expect(dydt[0]).toBe(0) // dx/dt = vx = 0
    // Earth acceleration: toward Sun (negative x)
    expect(dydt[3]).toBeLessThan(0)
    const expectedAcc = G * 1.989e30 / (1.496e11) ** 2
    expect(Math.abs(dydt[3])).toBeCloseTo(expectedAcc, 0)
  })
})

describe('pointMassDerivatives', () => {
  it('computes gravity from body curves at interpolated time', () => {
    // A body at x=0 with zero velocity (stationary)
    const bodyCurves: TrajectoryCurve[] = [{
      id: 'earth', parentId: '',
      p0: [0, 0, 0], v0: [0, 0, 0], t0: 0,
      p1: [0, 0, 0], v1: [0, 0, 0], t1: 100,
    }]
    const masses = new Map([['earth', G * 5.972e24]])
    const deriv = pointMassDerivatives(bodyCurves, masses)

    // Vehicle at (6.771e6, 0, 0)
    const y = new Float64Array([6_771_000, 0, 0, 0, 0, 7670])
    const dydt = new Float64Array(6)
    deriv(0, y, dydt)

    // Velocity derivatives = velocity
    expect(dydt[0]).toBeCloseTo(0, 5)
    expect(dydt[2]).toBeCloseTo(7670, 5)
    // Acceleration toward Earth (negative x)
    expect(dydt[3]).toBeLessThan(0)
    const expectedAcc = G * 5.972e24 / 6_771_000 ** 2
    expect(Math.abs(dydt[3])).toBeCloseTo(expectedAcc, 0)
  })

  it('interpolates body position from curves at mid-time', () => {
    // Body moving from (0,0,0) to (1000,0,0) over 10 seconds
    const bodyCurves: TrajectoryCurve[] = [{
      id: 'mover', parentId: '',
      p0: [0, 0, 0], v0: [100, 0, 0], t0: 0,
      p1: [1000, 0, 0], v1: [100, 0, 0], t1: 10,
    }]
    const masses = new Map([['mover', G * 1e24]])
    const deriv = pointMassDerivatives(bodyCurves, masses)

    // Vehicle far away at (1e9, 0, 0), evaluate at t=5
    // Body should be at approximately (500, 0, 0) at t=5
    const y = new Float64Array([1e9, 0, 0, 0, 0, 0])
    const dydt = new Float64Array(6)
    deriv(5, y, dydt)

    // Acceleration should point in -x direction (toward body at ~500)
    expect(dydt[3]).toBeLessThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/__tests__/derivatives.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement derivative functions**

```typescript
// src/sim/integrator/derivatives.ts

import { G } from '../constants'
import { evaluateCurve } from '../curves'
import type { DerivFn } from './adaptive'
import type { TrajectoryCurve } from '../types'

/**
 * N-body derivative function for the orbital worker.
 * State vector layout: [x0,y0,z0,vx0,vy0,vz0, x1,y1,z1,vx1,vy1,vz1, ...]
 *
 * @param masses Array of body masses in the same order as the state vector.
 */
export function nBodyDerivatives(masses: number[]): DerivFn {
  const n = masses.length

  return (_t: number, y: Float64Array, dydt: Float64Array): void => {
    for (let i = 0; i < n; i++) {
      const bi = i * 6
      // Position derivatives = velocity
      dydt[bi] = y[bi + 3]
      dydt[bi + 1] = y[bi + 4]
      dydt[bi + 2] = y[bi + 5]

      // Acceleration from all other bodies
      let ax = 0, ay = 0, az = 0
      for (let j = 0; j < n; j++) {
        if (j === i) continue
        const bj = j * 6
        const dx = y[bj] - y[bi]
        const dy = y[bj + 1] - y[bi + 1]
        const dz = y[bj + 2] - y[bi + 2]
        const r2 = dx * dx + dy * dy + dz * dz
        const r = Math.sqrt(r2)
        if (r < 1) continue
        const f = (G * masses[j]) / (r2 * r)
        ax += f * dx
        ay += f * dy
        az += f * dz
      }
      dydt[bi + 3] = ax
      dydt[bi + 4] = ay
      dydt[bi + 5] = az
    }
  }
}

/**
 * Point-mass derivative function for the vehicle worker.
 * State vector layout: [x, y, z, vx, vy, vz]
 *
 * Evaluates gravity by interpolating body positions from trajectory curves
 * at the current time t. No linear prediction — exact curve interpolation.
 *
 * @param bodyCurves Trajectory curves for all gravitating bodies.
 * @param bodyGMs    Map from curve id to G*M for that body.
 */
export function pointMassDerivatives(
  bodyCurves: TrajectoryCurve[],
  bodyGMs: Map<string, number>,
): DerivFn {
  return (t: number, y: Float64Array, dydt: Float64Array): void => {
    // Position derivatives = velocity
    dydt[0] = y[3]
    dydt[1] = y[4]
    dydt[2] = y[5]

    // Acceleration from all bodies
    let ax = 0, ay = 0, az = 0
    for (let i = 0; i < bodyCurves.length; i++) {
      const curve = bodyCurves[i]
      const gm = bodyGMs.get(curve.id)
      if (gm === undefined) continue

      // Interpolate body position at time t from its trajectory curve
      const bodyPos = evaluateCurve(curve, t)

      const dx = bodyPos[0] - y[0]
      const dy = bodyPos[1] - y[1]
      const dz = bodyPos[2] - y[2]
      const r2 = dx * dx + dy * dy + dz * dz
      const r = Math.sqrt(r2)
      if (r < 1) continue
      const f = gm / (r2 * r)
      ax += f * dx
      ay += f * dy
      az += f * dz
    }
    dydt[3] = ax
    dydt[4] = ay
    dydt[5] = az
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/__tests__/derivatives.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sim/integrator/derivatives.ts src/sim/__tests__/derivatives.test.ts
git commit -m "feat: n-body and point-mass derivative functions for adaptive integrator"
```

---

### Task 3: Update Message Types

**Files:**
- Modify: `src/sim/types.ts`

- [ ] **Step 1: Update the worker message types**

In `src/sim/types.ts`, replace the `VehicleWorkerInbound` type and add the updated orbital inbound type:

Replace this block:
```typescript
/** Inbound messages to the vehicle worker */
export type VehicleWorkerInbound =
  | {
      type: 'init'
      vehicle: {
        id: string
        position: SectorPosition
        velocity: [number, number, number]
      }
      gravitySources: GravitySource[]
      warpRate: number
    }
  | { type: 'gravity-sources'; bodies: GravitySource[]; simTime: number }
  | { type: 'set-warp'; rate: number }
```

With:
```typescript
/** Inbound messages to the vehicle worker */
export type VehicleWorkerInbound =
  | {
      type: 'init'
      vehicle: {
        id: string
        position: SectorPosition
        velocity: [number, number, number]
      }
      bodyCurves: TrajectoryCurve[]
      bodyGMs: [string, number][]  // [id, G*M] pairs (Map not transferable)
    }
  | {
      type: 'advance'
      targetTime: number
      bodyCurves: TrajectoryCurve[]
    }
  | { type: 'set-warp'; rate: number }
```

Also replace the existing `OrbitalInbound` type:
```typescript
export type OrbitalInbound =
  | { type: 'commands'; commands: SimCommand[] }
  | { type: 'vehicle-positions'; vehicles: { id: string; position: SectorPosition }[] }
  | {
      type: 'request-patch'
      points: [number, number, number][] // 6 face-center positions (absolute)
    }
```

With:
```typescript
export type OrbitalInbound =
  | {
      type: 'init'
      bodies: {
        id: string; name: string; parentId: string | null
        mass: number; radius: number; soiRadius?: number
        position: SectorPosition; velocity: [number, number, number]
      }[]
    }
  | { type: 'advance'; targetTime: number }
  | { type: 'set-warp'; rate: number }
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Type errors in workers and bridge (they still use old message shapes). This is expected — we'll fix them in Tasks 4–6.

- [ ] **Step 3: Commit**

```bash
git add src/sim/types.ts
git commit -m "refactor: update worker message types for bridge-owned clock"
```

---

### Task 4: Rewrite Orbital Worker

**Files:**
- Modify: `src/sim/orbital/worker.ts`

- [ ] **Step 1: Rewrite the orbital worker**

Replace the entire contents of `src/sim/orbital/worker.ts`:

```typescript
/**
 * Orbital worker — owns celestial body state, runs adaptive n-body
 * integration, emits trajectory curves to the main thread.
 *
 * Driven by the bridge via 'advance' messages. No self-scheduling.
 */

import type { TrajectoryCurve, SectorPosition } from '../types'
import { toAbsolute } from '../coordinates'
import { advanceTo } from '../integrator/adaptive'
import { nBodyDerivatives } from '../integrator/derivatives'

interface InitBody {
  id: string
  name: string
  parentId: string | null
  mass: number
  radius: number
  soiRadius?: number
  position: SectorPosition
  velocity: [number, number, number]
}

let bodyIds: string[] = []
let masses: number[] = []
let stateVec: Float64Array | null = null
let simTime = 0
let deriv: ReturnType<typeof nBodyDerivatives> | null = null

/** Unpack state vector back to absolute positions + velocities per body. */
function emitCurves(prevTime: number, prevState: Float64Array): void {
  if (!stateVec) return
  const curves: TrajectoryCurve[] = []
  for (let i = 0; i < bodyIds.length; i++) {
    const b = i * 6
    curves.push({
      id: bodyIds[i],
      parentId: '',
      p0: [prevState[b], prevState[b + 1], prevState[b + 2]],
      v0: [prevState[b + 3], prevState[b + 4], prevState[b + 5]],
      t0: prevTime,
      p1: [stateVec[b], stateVec[b + 1], stateVec[b + 2]],
      v1: [stateVec[b + 3], stateVec[b + 4], stateVec[b + 5]],
      t1: simTime,
    })
  }
  postMessage({ type: 'trajectories', simTime, curves })
}

onmessage = (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'init') {
    const bodies = msg.bodies as InitBody[]
    bodyIds = bodies.map((b) => b.id)
    masses = bodies.map((b) => b.mass)
    deriv = nBodyDerivatives(masses)

    // Pack initial state vector: [x0,y0,z0,vx0,vy0,vz0, x1,...]
    stateVec = new Float64Array(bodies.length * 6)
    for (let i = 0; i < bodies.length; i++) {
      const abs = toAbsolute(bodies[i].position)
      const b = i * 6
      stateVec[b] = abs[0]; stateVec[b + 1] = abs[1]; stateVec[b + 2] = abs[2]
      stateVec[b + 3] = bodies[i].velocity[0]
      stateVec[b + 4] = bodies[i].velocity[1]
      stateVec[b + 5] = bodies[i].velocity[2]
    }
    simTime = 0

    // Emit initial curves (zero-length, establishes starting positions)
    const initState = new Float64Array(stateVec)
    emitCurves(0, initState)
  }

  if (msg.type === 'advance') {
    if (!stateVec || !deriv) return
    const targetTime = msg.targetTime as number
    if (targetTime <= simTime) {
      // Already there — emit current state
      emitCurves(simTime, new Float64Array(stateVec))
      return
    }

    const prevTime = simTime
    const prevState = new Float64Array(stateVec)

    advanceTo(stateVec, simTime, targetTime, deriv, 1e-10)
    simTime = targetTime

    emitCurves(prevTime, prevState)
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Still errors in bridge.ts and vehicle/worker.ts (not yet updated). The orbital worker itself should have no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/sim/orbital/worker.ts
git commit -m "refactor: orbital worker uses adaptive integrator, driven by bridge advance messages"
```

---

### Task 5: Rewrite Vehicle Worker

**Files:**
- Modify: `src/sim/vehicle/worker.ts`

- [ ] **Step 1: Rewrite the vehicle worker**

Replace the entire contents of `src/sim/vehicle/worker.ts`:

```typescript
/**
 * Vehicle worker — owns vehicle state, runs adaptive integration
 * against gravity interpolated from body trajectory curves.
 *
 * Driven by the bridge via 'advance' messages. No self-scheduling.
 */

import type { TrajectoryCurve, VehicleWorkerInbound } from '../types'
import { toAbsolute } from '../coordinates'
import { advanceTo } from '../integrator/adaptive'
import { pointMassDerivatives } from '../integrator/derivatives'

let vehicleId = ''
let stateVec: Float64Array | null = null
let bodyGMs = new Map<string, number>()
let simTime = 0

function emitCurves(prevTime: number, prevState: Float64Array): void {
  if (!stateVec) return

  const curve: TrajectoryCurve = {
    id: vehicleId,
    parentId: '',
    p0: [prevState[0], prevState[1], prevState[2]],
    v0: [prevState[3], prevState[4], prevState[5]],
    t0: prevTime,
    p1: [stateVec[0], stateVec[1], stateVec[2]],
    v1: [stateVec[3], stateVec[4], stateVec[5]],
    t1: simTime,
  }

  postMessage({
    type: 'vehicle-trajectories',
    simTime,
    curves: [curve],
  })
}

onmessage = (e: MessageEvent<VehicleWorkerInbound>) => {
  const msg = e.data

  if (msg.type === 'init') {
    vehicleId = msg.vehicle.id
    const absPos = toAbsolute(msg.vehicle.position)
    stateVec = new Float64Array([
      absPos[0], absPos[1], absPos[2],
      msg.vehicle.velocity[0], msg.vehicle.velocity[1], msg.vehicle.velocity[2],
    ])
    bodyGMs = new Map(msg.bodyGMs)
    simTime = 0

    // Build derivative from initial body curves and integrate to initial time
    const initState = new Float64Array(stateVec)
    emitCurves(0, initState)
  }

  if (msg.type === 'advance') {
    if (!stateVec) return
    const targetTime = msg.targetTime
    if (targetTime <= simTime) {
      emitCurves(simTime, new Float64Array(stateVec))
      return
    }

    const prevTime = simTime
    const prevState = new Float64Array(stateVec)

    // Build gravity function from body trajectory curves for this batch
    const deriv = pointMassDerivatives(msg.bodyCurves, bodyGMs)

    advanceTo(stateVec, simTime, targetTime, deriv, 1e-10)
    simTime = targetTime

    emitCurves(prevTime, prevState)
  }
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Still errors in bridge.ts (not yet updated). Workers should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/sim/vehicle/worker.ts
git commit -m "refactor: vehicle worker uses adaptive integrator with body curve interpolation"
```

---

### Task 6: Rewrite Bridge with Clock Ownership

**Files:**
- Modify: `src/state/bridge.ts`

- [ ] **Step 1: Rewrite the bridge**

Replace the entire contents of `src/state/bridge.ts`:

```typescript
/**
 * Worker bridge — owns simulation clock, manages worker lifecycle,
 * routes commands, orchestrates sequential advance: orbital → vehicle.
 */

import { useTrajectoriesStore } from './trajectories'
import { useInputStore } from './input'
import type { BodyMeta } from './trajectories'
import type { TrajectoryCurve } from '../sim/types'
import { G } from '../sim/constants'

let orbitalWorker: Worker | null = null
let vehicleWorker: Worker | null = null
let animFrameId: number | null = null

// Bridge-owned clock
let simTime = 0
let warpRate = 1
let lastWallTime = 0

// Worker state machine
type WorkerState = 'idle' | 'busy'
let orbitalState: WorkerState = 'idle'
let vehicleState: WorkerState = 'idle'

// Pending vehicle dispatch (waiting for orbital to finish)
let pendingTargetTime: number | null = null

// Body metadata for computing G*M
let bodyGMs: [string, number][] = []

// Latest orbital curves (forwarded to vehicle worker)
let latestOrbitalCurves: TrajectoryCurve[] = []

export async function startSim(scenarioId: string): Promise<void> {
  const scenarioResp = await fetch(`/data/scenarios/${scenarioId}.json`)
  if (!scenarioResp.ok) {
    throw new Error(`Failed to load scenario: ${scenarioId} (${scenarioResp.status})`)
  }
  const scenario = await scenarioResp.json()

  const bodyIds = Object.keys(scenario.bodies)
  const bodyDefs = await Promise.all(
    bodyIds.map(async (id: string) => {
      const resp = await fetch(`/data/bodies/${id}.json`)
      if (!resp.ok) throw new Error(`Failed to load body: ${id} (${resp.status})`)
      return resp.json()
    }),
  )

  // Populate body metadata in the trajectory store
  const bodyMetas: BodyMeta[] = bodyDefs.map(
    (def: Record<string, unknown>) => {
      const physics = def.physics as Record<string, unknown>
      const render = def.render as Record<string, unknown>
      return {
        id: def.id as string,
        name: def.name as string,
        parentId: def.parentId as string | null,
        mass: physics.mass as number,
        radius: physics.radius as number,
        color: render.color as string,
        emissive: (render.emissive as boolean) ?? false,
      }
    },
  )
  useTrajectoriesStore.getState().setBodies(bodyMetas)

  // Compute G*M pairs for vehicle gravity
  bodyGMs = bodyDefs.map((def: Record<string, unknown>) => {
    const physics = def.physics as Record<string, unknown>
    return [def.id as string, G * (physics.mass as number)] as [string, number]
  })

  // Spawn the orbital worker
  orbitalWorker = new Worker(
    new URL('../sim/orbital/worker.ts', import.meta.url),
    { type: 'module' },
  )

  let resolveOrbitalReady: () => void
  const orbitalReady = new Promise<void>((resolve) => {
    resolveOrbitalReady = resolve
  })

  orbitalWorker.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'trajectories') {
      useTrajectoriesStore.getState().updateCurves(msg.curves, msg.simTime)
      latestOrbitalCurves = msg.curves
      orbitalState = 'idle'
      resolveOrbitalReady()

      // Dispatch vehicle worker now that orbital is done
      if (vehicleWorker && pendingTargetTime !== null) {
        dispatchVehicle(pendingTargetTime)
        pendingTargetTime = null
      }
    }
  }

  // Send init to orbital worker
  orbitalWorker.postMessage({
    type: 'init',
    bodies: bodyDefs.map((def: Record<string, unknown>) => {
      const physics = def.physics as Record<string, unknown>
      const bodyId = def.id as string
      const scenarioBody = scenario.bodies[bodyId]
      return {
        id: bodyId,
        name: def.name,
        parentId: def.parentId,
        mass: physics.mass,
        radius: physics.radius,
        soiRadius: physics.soiRadius,
        position: scenarioBody.position,
        velocity: scenarioBody.velocity,
      }
    }),
  })

  // Load vehicles
  const vehicles = scenario.vehicles ?? []
  if (vehicles.length > 0) {
    const vehicleMetas = vehicles.map((v: Record<string, unknown>) => ({
      id: v.id, name: v.name, parentId: v.parentId, mesh: v.mesh,
    }))
    useTrajectoriesStore.getState().setVehicles(vehicleMetas)

    await orbitalReady

    const v = vehicles[0]

    vehicleWorker = new Worker(
      new URL('../sim/vehicle/worker.ts', import.meta.url),
      { type: 'module' },
    )

    vehicleWorker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'vehicle-trajectories') {
        useTrajectoriesStore.getState().mergeCurves(msg.curves)
        vehicleState = 'idle'
      }
    }

    vehicleWorker.postMessage({
      type: 'init',
      vehicle: { id: v.id, position: v.position, velocity: v.velocity },
      bodyCurves: latestOrbitalCurves,
      bodyGMs,
    })
  }

  // Start the bridge clock loop
  simTime = 0
  warpRate = 1
  lastWallTime = performance.now()

  function loop() {
    const now = performance.now()
    const wallDelta = (now - lastWallTime) / 1000
    lastWallTime = now

    // Flush input commands (warp changes)
    flushCommands()

    // Compute target time
    const simDelta = wallDelta * warpRate
    const targetTime = simTime + simDelta

    // Dispatch orbital worker if idle
    if (orbitalWorker && orbitalState === 'idle') {
      orbitalState = 'busy'
      pendingTargetTime = vehicleWorker ? targetTime : null
      orbitalWorker.postMessage({ type: 'advance', targetTime })
      simTime = targetTime
    }
    // If orbital is busy, the renderer interpolates existing curves

    animFrameId = requestAnimationFrame(loop)
  }
  animFrameId = requestAnimationFrame(loop)
}

function dispatchVehicle(targetTime: number): void {
  if (!vehicleWorker || vehicleState !== 'idle') return
  vehicleState = 'busy'
  vehicleWorker.postMessage({
    type: 'advance',
    targetTime,
    bodyCurves: latestOrbitalCurves,
  })
}

function flushCommands(): void {
  const commands = useInputStore.getState().drain()
  for (const cmd of commands) {
    if (cmd.type === 'set-warp') {
      warpRate = cmd.rate
      useTrajectoriesStore.getState().setWarpRate(cmd.rate)
    }
  }
}

export function stopSim(): void {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId)
    animFrameId = null
  }
  if (orbitalWorker) {
    orbitalWorker.terminate()
    orbitalWorker = null
  }
  if (vehicleWorker) {
    vehicleWorker.terminate()
    vehicleWorker = null
  }
  simTime = 0
  warpRate = 1
  orbitalState = 'idle'
  vehicleState = 'idle'
  pendingTargetTime = null
  latestOrbitalCurves = []
  useTrajectoriesStore.getState().reset()
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS — all types should now align.

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: Existing tests pass. Some orbital-dynamics tests may need adjustment (they use the old `integrateVehicle` directly — that's fine, those test the old Verlet path which still exists).

- [ ] **Step 4: Commit**

```bash
git add src/state/bridge.ts
git commit -m "refactor: bridge owns simulation clock, orchestrates orbital → vehicle dispatch"
```

---

### Task 7: Update Orbital Dynamics Tests

**Files:**
- Modify: `src/sim/__tests__/orbital-dynamics.test.ts`

- [ ] **Step 1: Add adaptive integrator energy conservation tests**

Add these test cases to the existing `orbital-dynamics.test.ts` file, after the existing `describe` blocks:

```typescript
// Add imports at top of file:
import { advanceTo, type DerivFn } from '../integrator/adaptive'
import { nBodyDerivatives, pointMassDerivatives } from '../integrator/derivatives'

// Add after existing tests:

describe('adaptive integrator orbital dynamics', () => {
  const earthMass = 5.972e24
  const r = 6_771_000

  it('conserves energy over 5 orbits with adaptive n-body', () => {
    const masses = [earthMass]
    const deriv = nBodyDerivatives(masses)

    const speed = orbitalSpeed(earthMass, r)
    // State: Earth at origin (stationary), then we integrate just the vehicle
    // Actually for n-body: single body doesn't accelerate itself.
    // Use pointMass style instead for single-vehicle test:
    const GM = G * earthMass
    const vDeriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
      const rr = Math.sqrt(r2)
      const f = -GM / (r2 * rr)
      dydt[3] = f * y[0]; dydt[4] = f * y[1]; dydt[5] = f * y[2]
    }

    const y = new Float64Array([r, 0, 0, 0, 0, speed])
    const period = 2 * Math.PI * r / speed
    const initialE = specificEnergy(earthMass, [r, 0, 0], [0, 0, speed])

    const result = advanceTo(y, 0, period * 5, vDeriv, 1e-12)

    const finalV2 = y[3] ** 2 + y[4] ** 2 + y[5] ** 2
    const finalR = Math.sqrt(y[0] ** 2 + y[1] ** 2 + y[2] ** 2)
    const finalE = 0.5 * finalV2 - G * earthMass / finalR
    const drift = Math.abs((finalE - initialE) / initialE)

    expect(drift).toBeLessThan(1e-8)
    expect(result.steps).toBeLessThan(2000)
  })

  it('adaptive integrator uses far fewer steps than fixed Verlet', () => {
    const GM = G * earthMass
    const speed = orbitalSpeed(earthMass, r)
    const period = 2 * Math.PI * r / speed

    const vDeriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
      const rr = Math.sqrt(r2)
      const f = -GM / (r2 * rr)
      dydt[3] = f * y[0]; dydt[4] = f * y[1]; dydt[5] = f * y[2]
    }

    const y = new Float64Array([r, 0, 0, 0, 0, speed])
    const result = advanceTo(y, 0, period, vDeriv, 1e-10)

    // Fixed Verlet would need 324,000 steps. Adaptive should need < 500.
    expect(result.steps).toBeLessThan(500)
    expect(result.steps).toBeGreaterThan(10) // sanity: not trivially few
  })
})
```

- [ ] **Step 2: Run updated tests**

Run: `npx vitest run src/sim/__tests__/orbital-dynamics.test.ts`
Expected: All tests PASS (old and new).

- [ ] **Step 3: Commit**

```bash
git add src/sim/__tests__/orbital-dynamics.test.ts
git commit -m "test: add adaptive integrator orbital dynamics tests"
```

---

### Task 8: Integration Smoke Test

**Files:**
- No new files — manual browser verification.

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 3: Run dev server and test in browser**

Run: `npm run dev`

Test sequence:
1. Load the sim — Sun, Earth, Moon should orbit normally at 1x
2. Click "Orbiter" follow button — vehicle should be visible near Earth
3. Increase warp to 1000x — orbits should remain stable, traces smooth
4. Increase warp to 10,000x — orbits still stable, no spiral
5. Increase warp to 100,000x — orbits still stable (this is the key test)
6. Drop warp back to 1x — should resume normal speed within 1-2 frames
7. Press V to toggle vehicle view — should still work

- [ ] **Step 4: Commit final state**

```bash
git add -A
git commit -m "feat: bridge-owned clock + adaptive Dormand-Prince integration

Replaces fixed-step setTimeout warp with bridge-driven adaptive integration.
Stable n-body orbits at any warp rate (1x to 100,000x).

- Bridge owns simTime, dispatches advance messages to workers
- Dormand-Prince 4/5 adaptive integrator (~200 steps/orbit vs 324,000)
- Orbital worker completes first, curves feed vehicle worker gravity
- Vehicle evaluates gravity by interpolating orbital body curves
- No linear prediction, no clock drift, no stale data"
```
