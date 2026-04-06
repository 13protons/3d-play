# Vehicle in Orbit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Place a passive vehicle in LEO, driven by its own web worker using cube-shaped environment patches for gravity, rendered in both an orbital overview and a vehicle-perspective dual canvas.

**Architecture:** Vehicle worker runs Störmer-Verlet integration using gravity evaluated from a flat Float64Array cube patch. The bridge owns the cube geometry (sizing, face-center positions, refresh triggers) and mediates all data flow between the orbital worker (gravity evaluator) and the vehicle worker (consumer). Two R3F canvases — orbital (existing, extended) and vehicle (new) — both stay mounted, inactive one frozen.

**Tech Stack:** TypeScript, Web Workers, React Three Fiber, Zustand, Vitest, Three.js

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `src/sim/cube-patch.ts` | Named index constants for Float64Array layout, `evaluateGravity()` function, cube sizing utility, inner-box check |
| `src/sim/vehicle/worker.ts` | Vehicle worker: Störmer-Verlet integration for single zero-mass body using cube patch gravity |
| `src/sim/__tests__/cube-patch.test.ts` | Tests for cube patch evaluation, sizing, inner-box check |
| `src/sim/__tests__/vehicle-worker.test.ts` | Tests for vehicle integration accuracy (energy conservation, orbital stability) |
| `src/render/VehicleScene.tsx` | Vehicle-perspective R3F Canvas with close camera, renders vehicle mesh + celestial hierarchy |
| `src/render/VehicleMarker.tsx` | Screen-space marker for vehicle in orbital canvas |

### Modified files
| File | Changes |
|------|---------|
| `src/sim/types.ts` | Add vehicle worker message types, remove old `EnvironmentPatch` |
| `src/sim/orbital/worker.ts` | Handle `request-patch` inbound message (evaluate gravity at 6 points) |
| `src/state/bridge.ts` | Spawn vehicle worker, cube patch lifecycle, relay messages, inner-box monitoring |
| `src/state/mode.ts` | Add `activeView: 'orbital' \| 'vehicle'` to flight state |
| `src/state/trajectories.ts` | Add `vehicles` record (parallel to `bodies`) for vehicle render metadata |
| `src/render/Scene.tsx` | Add VehicleMarker, add vehicle to orbit traces |
| `src/modes/Flight.tsx` | Add V key toggle, render both canvases, gate active/inactive |
| `src/ui/HUD.tsx` | Add vehicle follow button, view toggle button, show active view |
| `public/data/scenarios/sun-earth-moon.json` | Add `vehicles` array with LEO orbiter |

---

### Task 1: Cube Patch Layout and Evaluation

**Files:**
- Create: `src/sim/cube-patch.ts`
- Create: `src/sim/__tests__/cube-patch.test.ts`

- [ ] **Step 1: Write failing tests for cube patch constants and evaluation**

```typescript
// src/sim/__tests__/cube-patch.test.ts
import { describe, it, expect } from 'vitest'
import {
  CP_MIN_X, CP_MAX_X, CP_G_NEG_X, CP_G_POS_X,
  CP_G_NEG_Y, CP_G_POS_Y, CP_G_NEG_Z, CP_G_POS_Z,
  CP_GRAVITY_SIZE,
  evaluateGravity,
} from '../cube-patch'

describe('cube patch layout', () => {
  it('has correct index offsets', () => {
    expect(CP_MIN_X).toBe(0)
    expect(CP_MAX_X).toBe(3)
    expect(CP_G_NEG_X).toBe(6)
    expect(CP_G_POS_X).toBe(9)
    expect(CP_G_NEG_Y).toBe(12)
    expect(CP_G_POS_Y).toBe(15)
    expect(CP_G_NEG_Z).toBe(18)
    expect(CP_G_POS_Z).toBe(21)
    expect(CP_GRAVITY_SIZE).toBe(24)
  })
})

describe('evaluateGravity', () => {
  function makeUniformPatch(gx: number, gy: number, gz: number): Float64Array {
    const patch = new Float64Array(24)
    // Box from [0,0,0] to [1000,1000,1000]
    patch[0] = 0; patch[1] = 0; patch[2] = 0
    patch[3] = 1000; patch[4] = 1000; patch[5] = 1000
    // All 6 faces have the same gravity
    for (let i = 6; i < 24; i += 3) {
      patch[i] = gx; patch[i + 1] = gy; patch[i + 2] = gz
    }
    return patch
  }

  it('returns uniform gravity anywhere in a uniform field', () => {
    const patch = makeUniformPatch(0, -9.81, 0)
    const g = evaluateGravity(patch, 500, 500, 500)
    expect(g[0]).toBeCloseTo(0, 5)
    expect(g[1]).toBeCloseTo(-9.81, 5)
    expect(g[2]).toBeCloseTo(0, 5)
  })

  it('returns uniform gravity at box corner', () => {
    const patch = makeUniformPatch(0, -9.81, 0)
    const g = evaluateGravity(patch, 0, 0, 0)
    expect(g[1]).toBeCloseTo(-9.81, 5)
  })

  it('interpolates between opposing faces', () => {
    const patch = new Float64Array(24)
    patch[0] = 0; patch[1] = 0; patch[2] = 0
    patch[3] = 100; patch[4] = 100; patch[5] = 100
    // -X face: gravity = [10, 0, 0]
    patch[6] = 10; patch[7] = 0; patch[8] = 0
    // +X face: gravity = [20, 0, 0]
    patch[9] = 20; patch[10] = 0; patch[11] = 0
    // Y and Z faces: gravity = [0, 0, 0]
    // (indices 12-23 are already 0)

    // At x=50 (midpoint), tx=0.5: lerp(10,20,0.5)=15, averaged with 0+0 → 5
    const g = evaluateGravity(patch, 50, 50, 50)
    expect(g[0]).toBeCloseTo(5, 5)
  })

  it('returns exact face value at face center', () => {
    const patch = new Float64Array(24)
    patch[0] = 0; patch[1] = 0; patch[2] = 0
    patch[3] = 100; patch[4] = 100; patch[5] = 100
    // All faces: [0, -9.81, 0]
    for (let i = 6; i < 24; i += 3) {
      patch[i] = 0; patch[i + 1] = -9.81; patch[i + 2] = 0
    }
    const g = evaluateGravity(patch, 0, 50, 50) // at -X face center
    expect(g[1]).toBeCloseTo(-9.81, 5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/__tests__/cube-patch.test.ts`
Expected: FAIL — module `../cube-patch` not found

- [ ] **Step 3: Implement cube patch module**

```typescript
// src/sim/cube-patch.ts

/** Cube patch Float64Array layout — index constants */
export const CP_MIN_X = 0
export const CP_MIN_Y = 1
export const CP_MIN_Z = 2
export const CP_MAX_X = 3
export const CP_MAX_Y = 4
export const CP_MAX_Z = 5
export const CP_G_NEG_X = 6   // gravity −X face: [6, 7, 8]
export const CP_G_POS_X = 9   // gravity +X face: [9, 10, 11]
export const CP_G_NEG_Y = 12  // gravity −Y face: [12, 13, 14]
export const CP_G_POS_Y = 15  // gravity +Y face: [15, 16, 17]
export const CP_G_NEG_Z = 18  // gravity −Z face: [18, 19, 20]
export const CP_G_POS_Z = 21  // gravity +Z face: [21, 22, 23]
export const CP_GRAVITY_SIZE = 24

/**
 * Evaluate gravity at an absolute position inside the cube.
 * Lerps between opposing face values along each axis, averages the three contributions.
 */
export function evaluateGravity(
  patch: Float64Array,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const tx = (x - patch[CP_MIN_X]) / (patch[CP_MAX_X] - patch[CP_MIN_X])
  const ty = (y - patch[CP_MIN_Y]) / (patch[CP_MAX_Y] - patch[CP_MIN_Y])
  const tz = (z - patch[CP_MIN_Z]) / (patch[CP_MAX_Z] - patch[CP_MIN_Z])

  const oneThird = 1 / 3
  return [
    oneThird * (
      patch[CP_G_NEG_X]     + (patch[CP_G_POS_X]     - patch[CP_G_NEG_X])     * tx +
      patch[CP_G_NEG_Y]     + (patch[CP_G_POS_Y]     - patch[CP_G_NEG_Y])     * ty +
      patch[CP_G_NEG_Z]     + (patch[CP_G_POS_Z]     - patch[CP_G_NEG_Z])     * tz
    ),
    oneThird * (
      patch[CP_G_NEG_X + 1] + (patch[CP_G_POS_X + 1] - patch[CP_G_NEG_X + 1]) * tx +
      patch[CP_G_NEG_Y + 1] + (patch[CP_G_POS_Y + 1] - patch[CP_G_NEG_Y + 1]) * ty +
      patch[CP_G_NEG_Z + 1] + (patch[CP_G_POS_Z + 1] - patch[CP_G_NEG_Z + 1]) * tz
    ),
    oneThird * (
      patch[CP_G_NEG_X + 2] + (patch[CP_G_POS_X + 2] - patch[CP_G_NEG_X + 2]) * tx +
      patch[CP_G_NEG_Y + 2] + (patch[CP_G_POS_Y + 2] - patch[CP_G_NEG_Y + 2]) * ty +
      patch[CP_G_NEG_Z + 2] + (patch[CP_G_POS_Z + 2] - patch[CP_G_NEG_Z + 2]) * tz
    ),
  ]
}

/**
 * Check if a position is inside the inner box (50% inset from each face).
 * Returns true if position is inside (patch is still valid).
 */
export function isInsideInnerBox(
  patch: Float64Array,
  x: number,
  y: number,
  z: number,
): boolean {
  const qx = (patch[CP_MAX_X] - patch[CP_MIN_X]) * 0.25
  const qy = (patch[CP_MAX_Y] - patch[CP_MIN_Y]) * 0.25
  const qz = (patch[CP_MAX_Z] - patch[CP_MIN_Z]) * 0.25
  return (
    x >= patch[CP_MIN_X] + qx && x <= patch[CP_MAX_X] - qx &&
    y >= patch[CP_MIN_Y] + qy && y <= patch[CP_MAX_Y] - qy &&
    z >= patch[CP_MIN_Z] + qz && z <= patch[CP_MAX_Z] - qz
  )
}

const MIN_CUBE_SIDE = 1000 // 1 km floor

/**
 * Compute cube bounds centered on a position, sized by speed.
 * Returns [minX, minY, minZ, maxX, maxY, maxZ].
 */
export function computeCubeBounds(
  cx: number,
  cy: number,
  cz: number,
  speed: number,
  warpRate: number,
  dt: number,
): [number, number, number, number, number, number] {
  const half = Math.max(MIN_CUBE_SIDE, speed * warpRate * dt * 4) / 2
  return [
    cx - half, cy - half, cz - half,
    cx + half, cy + half, cz + half,
  ]
}
```

- [ ] **Step 4: Add tests for isInsideInnerBox and computeCubeBounds**

```typescript
// Append to src/sim/__tests__/cube-patch.test.ts
import { isInsideInnerBox, computeCubeBounds } from '../cube-patch'

describe('isInsideInnerBox', () => {
  function makeBox(min: number, max: number): Float64Array {
    const patch = new Float64Array(24)
    patch[0] = min; patch[1] = min; patch[2] = min
    patch[3] = max; patch[4] = max; patch[5] = max
    return patch
  }

  it('returns true at center', () => {
    expect(isInsideInnerBox(makeBox(0, 100), 50, 50, 50)).toBe(true)
  })

  it('returns false outside inner box but inside outer', () => {
    // Inner box is [25, 75] for a [0, 100] cube
    expect(isInsideInnerBox(makeBox(0, 100), 10, 50, 50)).toBe(false)
  })

  it('returns false at outer edge', () => {
    expect(isInsideInnerBox(makeBox(0, 100), 0, 0, 0)).toBe(false)
  })

  it('returns true at inner boundary', () => {
    expect(isInsideInnerBox(makeBox(0, 100), 25, 50, 50)).toBe(true)
  })
})

describe('computeCubeBounds', () => {
  it('centers cube on given position', () => {
    const [minX, minY, minZ, maxX, maxY, maxZ] = computeCubeBounds(
      1000, 2000, 3000, 7700, 1, 1 / 60,
    )
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const cz = (minZ + maxZ) / 2
    expect(cx).toBeCloseTo(1000)
    expect(cy).toBeCloseTo(2000)
    expect(cz).toBeCloseTo(3000)
  })

  it('enforces minimum 1km side length', () => {
    const [minX, , , maxX] = computeCubeBounds(0, 0, 0, 0, 1, 1 / 60)
    expect(maxX - minX).toBe(1000)
  })

  it('scales with speed and warp', () => {
    const [minX1, , , maxX1] = computeCubeBounds(0, 0, 0, 7700, 1, 1 / 60)
    const [minX2, , , maxX2] = computeCubeBounds(0, 0, 0, 7700, 10, 1 / 60)
    expect(maxX2 - minX2).toBeGreaterThan(maxX1 - minX1)
  })
})
```

- [ ] **Step 5: Run all tests to verify they pass**

Run: `npx vitest run src/sim/__tests__/cube-patch.test.ts`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/sim/cube-patch.ts src/sim/__tests__/cube-patch.test.ts
git commit -m "feat: cube patch layout constants, gravity evaluation, and inner-box check"
```

---

### Task 2: Update Types — Vehicle Worker Messages and Vehicle Metadata

**Files:**
- Modify: `src/sim/types.ts`
- Modify: `src/state/trajectories.ts`

- [ ] **Step 1: Update types.ts — add vehicle worker messages, remove old EnvironmentPatch**

Replace the `EnvironmentPatch` interface (lines 32-64 of `src/sim/types.ts`) and add vehicle worker message types. Also update `OrbitalInbound`/`WorkerOutbound` to include patch messages.

In `src/sim/types.ts`, remove the `EnvironmentPatch` interface and replace with:

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
      cubePatch: Float64Array
      warpRate: number
    }
  | { type: 'cube-patch'; data: Float64Array }
  | { type: 'set-warp'; rate: number }

/** Outbound messages from the vehicle worker */
export type VehicleWorkerOutbound =
  | {
      type: 'vehicle-trajectories'
      simTime: number
      curves: TrajectoryCurve[]
    }
  | {
      type: 'vehicle-position'
      position: [number, number, number]
      velocity: [number, number, number]
    }
```

Update `OrbitalInbound` to add `request-patch`:

```typescript
export type OrbitalInbound =
  | { type: 'commands'; commands: (VehicleCommand | SimCommand)[] }
  | { type: 'vehicle-positions'; vehicles: { id: string; position: SectorPosition }[] }
  | {
      type: 'request-patch'
      points: [number, number, number][] // 6 face-center positions (absolute)
    }
```

Update `WorkerOutbound` to add `cube-patch-response`:

```typescript
export type WorkerOutbound =
  | { type: 'trajectories'; simTime: number; curves: TrajectoryCurve[] }
  | { type: 'active'; active: boolean }
  | { type: 'event'; event: SimEvent }
  | {
      type: 'cube-patch-response'
      gravityVectors: [number, number, number][] // 6 gravity vectors at requested points
    }
```

- [ ] **Step 2: Add VehicleMeta to trajectories store**

In `src/state/trajectories.ts`, add a `VehicleMeta` interface and a `vehicles` record:

```typescript
export interface VehicleMeta {
  id: string
  name: string
  parentId: string
  mesh: string
}
```

Add to `TrajectoriesState`:
```typescript
vehicles: Record<string, VehicleMeta>
setVehicles: (vehicles: VehicleMeta[]) => void
```

Add to initial state:
```typescript
vehicles: {},
```

Add to the store:
```typescript
setVehicles: (vehicles) =>
  set({
    vehicles: Object.fromEntries(vehicles.map((v) => [v.id, v])),
  }),
```

Add to `reset`:
```typescript
reset: () =>
  set({
    curves: {},
    bodies: {},
    vehicles: {},
    simTime: 0,
    warpRate: 1,
    lastUpdateWallTime: performance.now(),
  }),
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS (or only errors from stubs referencing removed `EnvironmentPatch` — fix those)

- [ ] **Step 4: Fix vehicle/environment.ts if it references old EnvironmentPatch**

The file `src/sim/vehicle/environment.ts` uses the old `EnvironmentPatch` type. Since the cube patch replaces it, replace the file contents with a comment stub pointing to the new system:

```typescript
// Environment evaluation is now handled by src/sim/cube-patch.ts
// This file previously contained EnvironmentPatch-based evaluation.
// It will be repurposed for atmosphere/terrain evaluation in a future milestone.
```

- [ ] **Step 5: Run typecheck + tests**

Run: `npm run check`
Expected: all PASS

- [ ] **Step 6: Commit**

```bash
git add src/sim/types.ts src/state/trajectories.ts src/sim/vehicle/environment.ts
git commit -m "feat: vehicle worker message types, VehicleMeta in trajectory store, replace EnvironmentPatch with cube patch"
```

---

### Task 3: Orbital Worker — Handle request-patch

**Files:**
- Modify: `src/sim/orbital/worker.ts`
- Create: `src/sim/__tests__/orbital-patch.test.ts`

- [ ] **Step 1: Write test for gravity sampling at a point**

We need to test that the orbital worker can compute gravity at an arbitrary point. Extract gravity-at-point into a testable function in `src/sim/orbital/gravity.ts`:

```typescript
// src/sim/__tests__/orbital-patch.test.ts
import { describe, it, expect } from 'vitest'
import { gravityAtPoint } from '../orbital/gravity'
import { G } from '../constants'
import type { CelestialBody } from '../types'

function makeBody(
  id: string,
  mass: number,
  sx: number,
  sy: number,
  sz: number,
): CelestialBody {
  return {
    id,
    name: id,
    parentId: null as unknown as string,
    mass,
    radius: 1000,
    soiRadius: 1e9,
    position: { sector: [0, 0, 0], local: [sx, sy, sz] },
    velocity: [0, 0, 0],
    orientation: [0, 0, 0, 1] as [number, number, number, number],
    angularVelocity: 0,
  }
}

describe('gravityAtPoint', () => {
  it('computes gravity from a single body at known distance', () => {
    const body = makeBody('earth', 5.972e24, 0, 0, 0)
    const point: [number, number, number] = [6_771_000, 0, 0]
    const g = gravityAtPoint([body], point)

    const expected = (G * 5.972e24) / (6_771_000 ** 2)
    expect(Math.abs(g[0])).toBeCloseTo(expected, 0)
    // Direction: point is at +X from body, gravity pulls toward -X
    expect(g[0]).toBeLessThan(0)
    expect(Math.abs(g[1])).toBeLessThan(1e-10)
    expect(Math.abs(g[2])).toBeLessThan(1e-10)
  })

  it('sums gravity from multiple bodies', () => {
    const b1 = makeBody('a', 1e24, 0, 0, 0)
    const b2 = makeBody('b', 1e24, 200_000, 0, 0)
    const point: [number, number, number] = [100_000, 0, 0]
    const g = gravityAtPoint([b1, b2], point)

    // Equidistant from both → forces cancel in X
    expect(Math.abs(g[0])).toBeLessThan(1e-10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/sim/__tests__/orbital-patch.test.ts`
Expected: FAIL — `gravityAtPoint` not exported

- [ ] **Step 3: Add gravityAtPoint to gravity.ts**

Add to `src/sim/orbital/gravity.ts`:

```typescript
/**
 * Compute gravitational acceleration at an arbitrary absolute point
 * due to all bodies. Used by the orbital worker to fill cube patch face values.
 */
export function gravityAtPoint(
  bodies: CelestialBody[],
  point: [number, number, number],
): [number, number, number] {
  const acc: [number, number, number] = [0, 0, 0]

  for (const body of bodies) {
    const bx = body.position.sector[0] * SECTOR_SIZE + body.position.local[0]
    const by = body.position.sector[1] * SECTOR_SIZE + body.position.local[1]
    const bz = body.position.sector[2] * SECTOR_SIZE + body.position.local[2]

    const dx = bx - point[0]
    const dy = by - point[1]
    const dz = bz - point[2]

    const r2 = dx * dx + dy * dy + dz * dz
    const r = Math.sqrt(r2)
    if (r < 1) continue

    const f = (G * body.mass) / (r2 * r)
    acc[0] += f * dx
    acc[1] += f * dy
    acc[2] += f * dz
  }

  return acc
}
```

Note: Import `G` from `'../constants'` and `SECTOR_SIZE` from `'../constants'` at the top of gravity.ts.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/sim/__tests__/orbital-patch.test.ts`
Expected: all PASS

- [ ] **Step 5: Handle request-patch in orbital worker**

In `src/sim/orbital/worker.ts`, add a new message handler inside the `onmessage` callback:

```typescript
if (msg.type === 'request-patch') {
  const points: [number, number, number][] = msg.points
  const gravityVectors = points.map((pt) => gravityAtPoint(bodies, pt))
  postMessage({ type: 'cube-patch-response', gravityVectors })
}
```

Add the import for `gravityAtPoint` at the top of the worker file.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/sim/orbital/gravity.ts src/sim/orbital/worker.ts src/sim/__tests__/orbital-patch.test.ts
git commit -m "feat: gravityAtPoint for cube patch sampling, orbital worker handles request-patch"
```

---

### Task 4: Vehicle Worker

**Files:**
- Modify: `src/sim/vehicle/worker.ts` (replace stub)
- Create: `src/sim/__tests__/vehicle-worker.test.ts`

- [ ] **Step 1: Write tests for vehicle integration**

```typescript
// src/sim/__tests__/vehicle-worker.test.ts
import { describe, it, expect } from 'vitest'
import { integrateVehicle } from '../vehicle/integrate'
import { CP_MIN_X, CP_MAX_X, CP_GRAVITY_SIZE } from '../cube-patch'
import { G } from '../constants'

function makeGravityPatch(
  min: [number, number, number],
  max: [number, number, number],
  gravity: [number, number, number],
): Float64Array {
  const patch = new Float64Array(CP_GRAVITY_SIZE)
  patch[0] = min[0]; patch[1] = min[1]; patch[2] = min[2]
  patch[3] = max[0]; patch[4] = max[1]; patch[5] = max[2]
  for (let i = 6; i < 24; i += 3) {
    patch[i] = gravity[0]
    patch[i + 1] = gravity[1]
    patch[i + 2] = gravity[2]
  }
  return patch
}

describe('integrateVehicle', () => {
  it('constant velocity with zero gravity', () => {
    const state = {
      position: [0, 0, 0] as [number, number, number],
      velocity: [100, 0, 0] as [number, number, number],
    }
    const patch = makeGravityPatch([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6], [0, 0, 0])
    integrateVehicle(state, patch, 1)
    expect(state.position[0]).toBeCloseTo(100, 5)
    expect(state.velocity[0]).toBeCloseTo(100, 5)
  })

  it('accelerates under uniform gravity', () => {
    const state = {
      position: [0, 0, 0] as [number, number, number],
      velocity: [0, 0, 0] as [number, number, number],
    }
    const patch = makeGravityPatch([-1e6, -1e6, -1e6], [1e6, 1e6, 1e6], [0, -9.81, 0])
    integrateVehicle(state, patch, 1)
    // After 1s of free-fall: v = gt = 9.81, pos = 0.5*g*t^2 = 4.905
    expect(state.velocity[1]).toBeCloseTo(-9.81, 2)
    expect(state.position[1]).toBeCloseTo(-4.905, 2)
  })

  it('conserves energy in circular orbit (100 steps)', () => {
    // Vehicle at 400km altitude, circular velocity
    const r = 6_771_000
    const M = 5.972e24
    const v = Math.sqrt(G * M / r)
    const g = -G * M / (r * r)

    const state = {
      position: [r, 0, 0] as [number, number, number],
      velocity: [0, 0, v] as [number, number, number],
    }

    const dt = 1 / 60
    const initialKE = 0.5 * (v * v)
    const initialPE = -G * M / r
    const initialE = initialKE + initialPE

    for (let step = 0; step < 100; step++) {
      const px = state.position[0], py = state.position[1], pz = state.position[2]
      const dist = Math.sqrt(px * px + py * py + pz * pz)
      const gMag = -G * M / (dist * dist)
      const gx = gMag * (px / dist)
      const gy = gMag * (py / dist)
      const gz = gMag * (pz / dist)

      // Create patch centered on vehicle with this gravity on all faces
      const half = 50000
      const patch = makeGravityPatch(
        [px - half, py - half, pz - half],
        [px + half, py + half, pz + half],
        [gx, gy, gz],
      )
      integrateVehicle(state, patch, dt)
    }

    const finalSpeed = Math.sqrt(
      state.velocity[0] ** 2 + state.velocity[1] ** 2 + state.velocity[2] ** 2,
    )
    const finalDist = Math.sqrt(
      state.position[0] ** 2 + state.position[1] ** 2 + state.position[2] ** 2,
    )
    const finalKE = 0.5 * finalSpeed * finalSpeed
    const finalPE = -G * M / finalDist
    const finalE = finalKE + finalPE

    const drift = Math.abs((finalE - initialE) / initialE)
    expect(drift).toBeLessThan(0.001) // <0.1% energy drift
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/sim/__tests__/vehicle-worker.test.ts`
Expected: FAIL — `integrateVehicle` not found

- [ ] **Step 3: Create vehicle integration function**

```typescript
// src/sim/vehicle/integrate.ts
import { evaluateGravity } from '../cube-patch'

export interface VehicleState {
  position: [number, number, number]
  velocity: [number, number, number]
}

/**
 * Störmer-Verlet integration for a single vehicle using cube patch gravity.
 * Mutates state in place.
 */
export function integrateVehicle(
  state: VehicleState,
  patch: Float64Array,
  dt: number,
): void {
  const halfDt = dt * 0.5

  // Step 1: half-velocity update
  const g1 = evaluateGravity(
    patch,
    state.position[0],
    state.position[1],
    state.position[2],
  )
  state.velocity[0] += g1[0] * halfDt
  state.velocity[1] += g1[1] * halfDt
  state.velocity[2] += g1[2] * halfDt

  // Step 2: full-position update
  state.position[0] += state.velocity[0] * dt
  state.position[1] += state.velocity[1] * dt
  state.position[2] += state.velocity[2] * dt

  // Step 3: second half-velocity update
  const g2 = evaluateGravity(
    patch,
    state.position[0],
    state.position[1],
    state.position[2],
  )
  state.velocity[0] += g2[0] * halfDt
  state.velocity[1] += g2[1] * halfDt
  state.velocity[2] += g2[2] * halfDt
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/sim/__tests__/vehicle-worker.test.ts`
Expected: all PASS

- [ ] **Step 5: Implement the vehicle worker**

```typescript
// src/sim/vehicle/worker.ts
import type { VehicleWorkerInbound } from '../types'
import type { TrajectoryCurve } from '../types'
import { integrateVehicle, type VehicleState } from './integrate'
import { toAbsolute, normalize } from '../coordinates'
import type { SectorPosition } from '../types'

const DT = 1 / 60

let vehicleId = ''
let state: VehicleState = { position: [0, 0, 0], velocity: [0, 0, 0] }
let sectorPos: SectorPosition = { sector: [0, 0, 0], local: [0, 0, 0] }
let cubePatch: Float64Array = new Float64Array(24)
let simTime = 0
let warpRate = 1
let prevPosition: [number, number, number] = [0, 0, 0]
let prevVelocity: [number, number, number] = [0, 0, 0]
let prevTime = 0

function emitCurve(): void {
  const pos = toAbsolute(sectorPos)
  const curve: TrajectoryCurve = {
    id: vehicleId,
    parentId: '',
    p0: prevPosition,
    v0: prevVelocity,
    t0: prevTime,
    p1: [pos[0], pos[1], pos[2]],
    v1: [state.velocity[0], state.velocity[1], state.velocity[2]],
    t1: simTime,
  }
  prevPosition = [pos[0], pos[1], pos[2]]
  prevVelocity = [state.velocity[0], state.velocity[1], state.velocity[2]]
  prevTime = simTime

  postMessage({
    type: 'vehicle-trajectories',
    simTime,
    curves: [curve],
  })

  postMessage({
    type: 'vehicle-position',
    position: [pos[0], pos[1], pos[2]],
    velocity: [state.velocity[0], state.velocity[1], state.velocity[2]],
  })
}

function tick(): void {
  for (let i = 0; i < warpRate; i++) {
    integrateVehicle(state, cubePatch, DT)
    simTime += DT

    // Sync absolute position back to SectorPosition
    sectorPos.local[0] = state.position[0]
    sectorPos.local[1] = state.position[1]
    sectorPos.local[2] = state.position[2]
  }

  // Convert back to absolute for curve emission
  emitCurve()

  setTimeout(tick, 1000 / 60)
}

onmessage = (e: MessageEvent) => {
  const msg = e.data as VehicleWorkerInbound

  if (msg.type === 'init') {
    vehicleId = msg.vehicle.id
    sectorPos = {
      sector: [...msg.vehicle.position.sector],
      local: [...msg.vehicle.position.local],
    }
    const abs = toAbsolute(sectorPos)
    state.position = [abs[0], abs[1], abs[2]]
    state.velocity = [...msg.vehicle.velocity]
    cubePatch = msg.cubePatch
    simTime = 0
    warpRate = msg.warpRate

    prevPosition = [abs[0], abs[1], abs[2]]
    prevVelocity = [...msg.vehicle.velocity]
    prevTime = 0

    setTimeout(tick, 1000 / 60)
  }

  if (msg.type === 'cube-patch') {
    cubePatch = msg.data
  }

  if (msg.type === 'set-warp') {
    warpRate = msg.rate
  }
}
```

- [ ] **Step 6: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/sim/vehicle/integrate.ts src/sim/vehicle/worker.ts src/sim/__tests__/vehicle-worker.test.ts
git commit -m "feat: vehicle worker with Störmer-Verlet integration from cube patch gravity"
```

---

### Task 5: Scenario Data — Add Vehicle to Sun-Earth-Moon

**Files:**
- Modify: `public/data/scenarios/sun-earth-moon.json`

- [ ] **Step 1: Add vehicles array to scenario**

Add a `vehicles` key to the existing scenario JSON:

```json
{
  "id": "sun-earth-moon",
  "name": "Sun–Earth–Moon System",
  "epoch": 0,
  "bodies": {
    "sun": {
      "position": { "sector": [0, 0, 0], "local": [0, 0, 0] },
      "velocity": [0, 0, 0],
      "rotationPhase": 0
    },
    "earth": {
      "position": { "sector": [149600, 0, 0], "local": [0, 0, 0] },
      "velocity": [0, 0, 29783],
      "rotationPhase": 0
    },
    "moon": {
      "position": { "sector": [149984, 0, 0], "local": [400000, 0, 0] },
      "velocity": [0, 0, 30805],
      "rotationPhase": 0
    }
  },
  "vehicles": [
    {
      "id": "vehicle-1",
      "name": "Orbiter",
      "parentId": "earth",
      "position": { "sector": [149600, 0, 0], "local": [6771000, 0, 0] },
      "velocity": [0, 0, 7670],
      "mesh": "cylinder"
    }
  ]
}
```

Position: Earth's sector + 6,771 km local offset (Earth radius 6,371 km + 400 km altitude). Velocity: ~7,670 m/s for circular orbit at 400 km altitude, in the Z direction (same orbital plane as Earth).

- [ ] **Step 2: Commit**

```bash
git add public/data/scenarios/sun-earth-moon.json
git commit -m "feat: add LEO orbiter vehicle to sun-earth-moon scenario"
```

---

### Task 6: Bridge — Vehicle Worker Lifecycle and Cube Patch Pipeline

**Files:**
- Modify: `src/state/bridge.ts`

This is the most complex task. The bridge needs to:
1. Load vehicle data from scenario
2. Compute initial cube patch (request gravity from orbital worker)
3. Spawn vehicle worker with init + initial patch
4. Handle vehicle trajectory and position messages
5. Monitor vehicle position against inner box
6. Request new patches when needed

- [ ] **Step 1: Add vehicle worker variable and imports**

At the top of `src/state/bridge.ts`, add:

```typescript
import {
  computeCubeBounds,
  isInsideInnerBox,
  CP_MIN_X, CP_MIN_Y, CP_MIN_Z,
  CP_MAX_X, CP_MAX_Y, CP_MAX_Z,
  CP_G_NEG_X, CP_G_POS_X,
  CP_G_NEG_Y, CP_G_POS_Y,
  CP_G_NEG_Z, CP_G_POS_Z,
  CP_GRAVITY_SIZE,
} from '../sim/cube-patch'

let vehicleWorker: Worker | null = null
let currentPatch: Float64Array | null = null
let lastVehiclePosition: [number, number, number] | null = null
let lastVehicleVelocity: [number, number, number] | null = null
let pendingPatchResolve: ((patch: Float64Array) => void) | null = null
```

- [ ] **Step 2: Add helper to compute face-center sample points from bounds**

```typescript
function faceCenterPoints(
  bounds: [number, number, number, number, number, number],
): [number, number, number][] {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  return [
    [minX, cy, cz], // -X face center
    [maxX, cy, cz], // +X face center
    [cx, minY, cz], // -Y face center
    [cx, maxY, cz], // +Y face center
    [cx, cy, minZ], // -Z face center
    [cx, cy, maxZ], // +Z face center
  ]
}
```

- [ ] **Step 3: Add helper to assemble Float64Array from bounds + gravity vectors**

```typescript
function assemblePatch(
  bounds: [number, number, number, number, number, number],
  gravityVectors: [number, number, number][],
): Float64Array {
  const patch = new Float64Array(CP_GRAVITY_SIZE)
  patch[CP_MIN_X] = bounds[0]
  patch[CP_MIN_Y] = bounds[1]
  patch[CP_MIN_Z] = bounds[2]
  patch[CP_MAX_X] = bounds[3]
  patch[CP_MAX_Y] = bounds[4]
  patch[CP_MAX_Z] = bounds[5]
  for (let i = 0; i < 6; i++) {
    const base = CP_G_NEG_X + i * 3
    patch[base] = gravityVectors[i][0]
    patch[base + 1] = gravityVectors[i][1]
    patch[base + 2] = gravityVectors[i][2]
  }
  return patch
}
```

- [ ] **Step 4: Add requestPatchFromOrbital function**

```typescript
function requestPatchFromOrbital(
  bounds: [number, number, number, number, number, number],
): Promise<Float64Array> {
  return new Promise((resolve) => {
    pendingPatchResolve = (patch) => resolve(patch)
    const points = faceCenterPoints(bounds)
    orbitalWorker!.postMessage({ type: 'request-patch', points })
  })
}
```

- [ ] **Step 5: Update orbital worker onmessage handler**

In the `orbitalWorker.onmessage` callback, add handling for `cube-patch-response`:

```typescript
orbitalWorker.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'trajectories') {
    useTrajectoriesStore.getState().updateCurves(msg.curves, msg.simTime)
  }
  if (msg.type === 'cube-patch-response' && pendingPatchResolve) {
    const bounds: [number, number, number, number, number, number] = currentPatch
      ? [
          currentPatch[CP_MIN_X], currentPatch[CP_MIN_Y], currentPatch[CP_MIN_Z],
          currentPatch[CP_MAX_X], currentPatch[CP_MAX_Y], currentPatch[CP_MAX_Z],
        ]
      : [0, 0, 0, 0, 0, 0] // shouldn't happen
    // Use the bounds that were sent with the request — stored in pendingBounds
    const patch = assemblePatch(pendingBounds!, msg.gravityVectors)
    currentPatch = patch
    pendingPatchResolve(patch)
    pendingPatchResolve = null
  }
}
```

Actually, we need to track the bounds that were used for the request. Add `let pendingBounds` to the module variables and set it in `requestPatchFromOrbital`:

```typescript
let pendingBounds: [number, number, number, number, number, number] | null = null

function requestPatchFromOrbital(
  bounds: [number, number, number, number, number, number],
): Promise<Float64Array> {
  return new Promise((resolve) => {
    pendingPatchResolve = (patch) => resolve(patch)
    pendingBounds = bounds
    const points = faceCenterPoints(bounds)
    orbitalWorker!.postMessage({ type: 'request-patch', points })
  })
}
```

Then in the handler:

```typescript
if (msg.type === 'cube-patch-response' && pendingPatchResolve) {
  const patch = assemblePatch(pendingBounds!, msg.gravityVectors)
  currentPatch = patch
  pendingPatchResolve(patch)
  pendingPatchResolve = null
  pendingBounds = null
}
```

- [ ] **Step 6: Update startSim to load vehicles and spawn vehicle worker**

After the orbital worker init section in `startSim`, add:

```typescript
// Load vehicles from scenario
const vehicles = scenario.vehicles ?? []
if (vehicles.length > 0) {
  const vehicleMetas = vehicles.map((v: { id: string; name: string; parentId: string; mesh: string }) => ({
    id: v.id,
    name: v.name,
    parentId: v.parentId,
    mesh: v.mesh,
  }))
  useTrajectoriesStore.getState().setVehicles(vehicleMetas)

  // Use first vehicle for now
  const v = vehicles[0]
  const vAbs = toAbsolute(v.position)
  const speed = Math.sqrt(v.velocity[0] ** 2 + v.velocity[1] ** 2 + v.velocity[2] ** 2)

  // Request initial cube patch from orbital worker
  const initialBounds = computeCubeBounds(vAbs[0], vAbs[1], vAbs[2], speed, 1, DT)
  const initialPatch = await requestPatchFromOrbital(initialBounds)

  // Spawn vehicle worker
  vehicleWorker = new Worker(
    new URL('../sim/vehicle/worker.ts', import.meta.url),
    { type: 'module' },
  )

  vehicleWorker.onmessage = (e: MessageEvent) => {
    const msg = e.data
    if (msg.type === 'vehicle-trajectories') {
      useTrajectoriesStore.getState().updateCurves(msg.curves, msg.simTime)
    }
    if (msg.type === 'vehicle-position') {
      lastVehiclePosition = msg.position
      lastVehicleVelocity = msg.velocity
    }
  }

  vehicleWorker.postMessage({
    type: 'init',
    vehicle: {
      id: v.id,
      position: v.position,
      velocity: v.velocity,
    },
    cubePatch: initialPatch,
    warpRate: 1,
  })
}
```

Add `const DT = 1 / 60` and `import { toAbsolute } from '../sim/coordinates'` at the top.

- [ ] **Step 7: Add inner-box monitoring to flushCommands**

In `flushCommands()`, after routing commands, add vehicle position monitoring:

```typescript
// Check if vehicle needs a new cube patch
if (
  vehicleWorker &&
  currentPatch &&
  lastVehiclePosition &&
  lastVehicleVelocity &&
  !pendingPatchResolve // don't request if one is already in flight
) {
  const [px, py, pz] = lastVehiclePosition
  if (!isInsideInnerBox(currentPatch, px, py, pz)) {
    const speed = Math.sqrt(
      lastVehicleVelocity[0] ** 2 +
      lastVehicleVelocity[1] ** 2 +
      lastVehicleVelocity[2] ** 2,
    )
    const { warpRate } = useTrajectoriesStore.getState()
    const bounds = computeCubeBounds(px, py, pz, speed, warpRate, DT)
    requestPatchFromOrbital(bounds).then((patch) => {
      vehicleWorker?.postMessage({ type: 'cube-patch', data: patch })
    })
  }
}
```

- [ ] **Step 8: Route set-warp to vehicle worker**

In the command routing section of `flushCommands()`, alongside the orbital worker warp message:

```typescript
if (cmd.type === 'set-warp') {
  orbitalWorker.postMessage({ type: 'set-warp', rate: cmd.rate })
  vehicleWorker?.postMessage({ type: 'set-warp', rate: cmd.rate })
  useTrajectoriesStore.getState().setWarpRate(cmd.rate)
}
```

- [ ] **Step 9: Terminate vehicle worker in stopSim**

In `stopSim()`, add:

```typescript
if (vehicleWorker) {
  vehicleWorker.terminate()
  vehicleWorker = null
}
currentPatch = null
lastVehiclePosition = null
lastVehicleVelocity = null
pendingPatchResolve = null
pendingBounds = null
```

- [ ] **Step 10: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/state/bridge.ts
git commit -m "feat: bridge spawns vehicle worker, manages cube patch lifecycle and inner-box refresh"
```

---

### Task 7: Mode Store — Add Active View

**Files:**
- Modify: `src/state/mode.ts`

- [ ] **Step 1: Add activeView to mode store**

```typescript
// src/state/mode.ts
import { create } from 'zustand'

interface ModeState {
  view: 'menu' | 'flight'
  scenarioId: string | null
  activeView: 'orbital' | 'vehicle'
  enterFlight: (scenarioId: string) => void
  enterMenu: () => void
  setActiveView: (view: 'orbital' | 'vehicle') => void
  toggleView: () => void
}

export const useModeStore = create<ModeState>((set, get) => ({
  view: 'menu',
  scenarioId: null,
  activeView: 'orbital',

  enterFlight: (scenarioId) => set({ view: 'flight', scenarioId, activeView: 'orbital' }),
  enterMenu: () => set({ view: 'menu', scenarioId: null, activeView: 'orbital' }),
  setActiveView: (activeView) => set({ activeView }),
  toggleView: () =>
    set({ activeView: get().activeView === 'orbital' ? 'vehicle' : 'orbital' }),
}))
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/state/mode.ts
git commit -m "feat: add activeView to mode store with orbital/vehicle toggle"
```

---

### Task 8: Vehicle Scene (Vehicle-Perspective Canvas)

**Files:**
- Create: `src/render/VehicleScene.tsx`

- [ ] **Step 1: Create the vehicle-perspective canvas**

```typescript
// src/render/VehicleScene.tsx
import { useRef } from 'react'
import { useFrame, Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import type { Mesh, PointLight } from 'three'
import { useTrajectoriesStore } from '../state/trajectories'
import { useModeStore } from '../state/mode'
import { evaluateCurve } from '../sim/curves'

/**
 * Determine which bodies to render in the vehicle view:
 * parent, ancestors to root, and all children of each ancestor.
 */
function getCelestialHierarchy(
  bodies: Record<string, { parentId: string | null }>,
  vehicleParentId: string,
): string[] {
  const result = new Set<string>()

  // Walk up the parent chain
  const ancestors: string[] = []
  let current: string | null = vehicleParentId
  while (current) {
    ancestors.push(current)
    result.add(current)
    current = bodies[current]?.parentId ?? null
  }

  // Add all children of each ancestor
  for (const bodyId of Object.keys(bodies)) {
    const parentId = bodies[bodyId].parentId
    if (parentId && ancestors.includes(parentId)) {
      result.add(bodyId)
    }
  }

  return Array.from(result)
}

function VehicleBody({ bodyId, vehicleId }: { bodyId: string; vehicleId: string }) {
  const meshRef = useRef<Mesh>(null)
  const lightRef = useRef<PointLight>(null)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return
    const mesh = meshRef.current
    if (!mesh) return

    const store = useTrajectoriesStore.getState()
    const t = store.getSimTime()

    const bodyCurve = store.curves[bodyId]
    const vehicleCurve = store.curves[vehicleId]
    if (!bodyCurve || !vehicleCurve) return

    // Position relative to vehicle (floating origin)
    const bodyPos = evaluateCurve(bodyCurve, t)
    const vehPos = evaluateCurve(vehicleCurve, t)

    mesh.position.set(
      bodyPos[0] - vehPos[0],
      bodyPos[1] - vehPos[1],
      bodyPos[2] - vehPos[2],
    )

    if (lightRef.current) {
      lightRef.current.position.copy(mesh.position)
    }
  })

  if (!body) return null

  return (
    <group>
      <mesh ref={meshRef}>
        <sphereGeometry args={[body.radius, 32, 32]} />
        {body.emissive ? (
          <meshBasicMaterial color={body.color} />
        ) : (
          <meshStandardMaterial color={body.color} />
        )}
      </mesh>
      {body.emissive && (
        <pointLight ref={lightRef} intensity={2} distance={0} decay={0} />
      )}
    </group>
  )
}

function VehicleMesh() {
  return (
    <mesh>
      <cylinderGeometry args={[1, 1.5, 4, 8]} />
      <meshStandardMaterial color="#cccccc" />
    </mesh>
  )
}

function VehicleSceneContent() {
  const active = useModeStore((s) => s.activeView === 'vehicle')
  const bodies = useTrajectoriesStore((s) => s.bodies)
  const vehicles = useTrajectoriesStore((s) => s.vehicles)

  const vehicleIds = Object.keys(vehicles)
  if (vehicleIds.length === 0) return null
  const vehicleId = vehicleIds[0]
  const vehicle = vehicles[vehicleId]

  const visibleBodies = getCelestialHierarchy(bodies, vehicle.parentId)

  useFrame((_state, _delta) => {
    // Gate: skip all work when inactive
    if (!active) return
  })

  return (
    <>
      <ambientLight intensity={0.08} />
      <Stars radius={1e14} depth={1e14} count={3000} factor={1e12} fade />
      <OrbitControls
        minDistance={5}
        maxDistance={1e9}
        enableDamping
        dampingFactor={0.1}
      />
      <VehicleMesh />
      {visibleBodies.map((id) => (
        <VehicleBody key={id} bodyId={id} vehicleId={vehicleId} />
      ))}
    </>
  )
}

export function VehicleScene() {
  const active = useModeStore((s) => s.activeView === 'vehicle')

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: active ? 'block' : 'none',
      }}
    >
      <Canvas
        camera={{
          position: [0, 10, 30],
          near: 0.1,
          far: 1e9,
          fov: 60,
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <VehicleSceneContent />
      </Canvas>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/render/VehicleScene.tsx
git commit -m "feat: vehicle-perspective canvas with celestial hierarchy rendering"
```

---

### Task 9: Vehicle Marker for Orbital View

**Files:**
- Create: `src/render/VehicleMarker.tsx`
- Modify: `src/render/Scene.tsx`

- [ ] **Step 1: Create screen-space vehicle marker**

```typescript
// src/render/VehicleMarker.tsx
import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { evaluateCurve } from '../sim/curves'

interface VehicleMarkerProps {
  vehicleId: string
}

export function VehicleMarker({ vehicleId }: VehicleMarkerProps) {
  const meshRef = useRef<Mesh>(null)

  useFrame(({ camera }) => {
    const mesh = meshRef.current
    if (!mesh) return

    const store = useTrajectoriesStore.getState()
    const { followTargetId } = useCameraStore.getState()
    const t = store.getSimTime()

    const curve = store.curves[vehicleId]
    const targetCurve = store.curves[followTargetId]
    if (!curve) return

    const pos = evaluateCurve(curve, t)

    let camX = 0, camY = 0, camZ = 0
    if (targetCurve) {
      const camPos = evaluateCurve(targetCurve, t)
      camX = camPos[0]; camY = camPos[1]; camZ = camPos[2]
    }

    mesh.position.set(pos[0] - camX, pos[1] - camY, pos[2] - camZ)

    // Scale marker to maintain constant screen size
    const dist = camera.position.distanceTo(mesh.position)
    const scale = dist * 0.008
    mesh.scale.setScalar(Math.max(scale, 1000))
  })

  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[1, 0]} />
      <meshBasicMaterial color="#00ff88" />
    </mesh>
  )
}
```

- [ ] **Step 2: Add VehicleMarker and vehicle OrbitTrace to Scene.tsx**

In `src/render/Scene.tsx`, add:

```typescript
import { VehicleMarker } from './VehicleMarker'
```

Inside the Canvas, after the body/orbit-trace maps, add:

```typescript
{Object.keys(vehicles).map((id) => (
  <VehicleMarker key={`vm-${id}`} vehicleId={id} />
))}
{Object.keys(vehicles).map((id) => (
  <OrbitTrace key={`vtrace-${id}`} bodyId={id} />
))}
```

Also subscribe to vehicles:

```typescript
const vehicles = useTrajectoriesStore((s) => s.vehicles)
```

- [ ] **Step 3: Add vehicle to follow targets in HUD**

In `src/ui/HUD.tsx`, add vehicle buttons alongside body buttons:

```typescript
const vehicles = useTrajectoriesStore((s) => s.vehicles)
```

In the body follow buttons section, append:

```typescript
{Object.values(vehicles).map((v) => (
  <button
    key={v.id}
    onClick={() => setFollowTarget(v.id)}
    style={{
      background: followTargetId === v.id ? '#335533' : '#1a1a2e',
      color: followTargetId === v.id ? '#88ff88' : '#ccc',
      border: '1px solid #333',
      padding: '4px 8px',
      cursor: 'pointer',
      fontFamily: 'monospace',
      fontSize: 12,
    }}
  >
    {v.name}
  </button>
))}
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/VehicleMarker.tsx src/render/Scene.tsx src/ui/HUD.tsx
git commit -m "feat: vehicle marker in orbital view, vehicle orbit trace, vehicle in follow targets"
```

---

### Task 10: Flight Mode — Dual Canvas with V-Key Toggle

**Files:**
- Modify: `src/modes/Flight.tsx`
- Modify: `src/ui/HUD.tsx`

- [ ] **Step 1: Update Flight.tsx to render both canvases**

```typescript
// src/modes/Flight.tsx
import { useEffect } from 'react'
import { useTrajectoriesStore } from '../state/trajectories'
import { useModeStore } from '../state/mode'
import { useInputStore } from '../state/input'
import { stopSim } from '../state/bridge'
import { nextWarpRate, prevWarpRate } from '../sim/warp'
import { Scene } from '../render/Scene'
import { VehicleScene } from '../render/VehicleScene'
import { HUD } from '../ui/HUD'

export function Flight() {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const { warpRate, simTime } = useTrajectoriesStore.getState()

      if (e.key === ']') {
        useInputStore.getState().push({
          type: 'set-warp',
          rate: nextWarpRate(warpRate),
          simTime,
        })
      }

      if (e.key === '[') {
        useInputStore.getState().push({
          type: 'set-warp',
          rate: prevWarpRate(warpRate),
          simTime,
        })
      }

      if (e.key === 'Escape') {
        stopSim()
        useModeStore.getState().enterMenu()
      }

      if (e.key === 'v' || e.key === 'V') {
        useModeStore.getState().toggleView()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const activeView = useModeStore((s) => s.activeView)

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: activeView === 'orbital' ? 'block' : 'none',
        }}
      >
        <Scene />
      </div>
      <VehicleScene />
      <HUD />
    </div>
  )
}
```

- [ ] **Step 2: Add view toggle button and indicator to HUD**

In `src/ui/HUD.tsx`, add:

```typescript
const activeView = useModeStore((s) => s.activeView)
const toggleView = useModeStore((s) => s.toggleView)
```

Add import for `useModeStore`.

Add a view indicator and toggle button in the HUD layout, after the FOLLOWING display:

```typescript
<div>
  <div style={{ opacity: 0.6, fontSize: 11 }}>VIEW</div>
  <div>{activeView.toUpperCase()}</div>
</div>
```

Add a toggle button in the controls area:

```typescript
<button
  onClick={toggleView}
  style={{
    background: '#1a1a2e',
    color: '#ccc',
    border: '1px solid #333',
    padding: '4px 8px',
    cursor: 'pointer',
    fontFamily: 'monospace',
    fontSize: 12,
  }}
>
  Toggle View (V)
</button>
```

Update help text to include V:

```typescript
<div style={{ marginTop: 8, opacity: 0.4, fontSize: 11 }}>
  [ / ] warp &nbsp; V toggle view &nbsp; scroll to zoom &nbsp; drag to orbit &nbsp; esc menu
</div>
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc -b --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/modes/Flight.tsx src/ui/HUD.tsx
git commit -m "feat: dual canvas with V-key toggle between orbital and vehicle views"
```

---

### Task 11: Gate useFrame in Orbital Scene When Inactive

**Files:**
- Modify: `src/render/Body.tsx`
- Modify: `src/render/OrbitTrace.tsx`
- Modify: `src/render/Scene.tsx`

When the orbital view is hidden, its useFrame callbacks should bail early to avoid unnecessary work.

- [ ] **Step 1: Add active prop to Scene's children**

In `src/render/Scene.tsx`, pass the active state via a React context or prop. The simplest approach: read the mode store inside each component's useFrame.

In `src/render/Body.tsx`, add at the top of the useFrame callback:

```typescript
const active = useModeStore.getState().activeView === 'orbital'
if (!active) return
```

Add import: `import { useModeStore } from '../state/mode'`

- [ ] **Step 2: Same for OrbitTrace.tsx**

In `src/render/OrbitTrace.tsx`, add at the top of the useFrame callback (after the group null check):

```typescript
if (useModeStore.getState().activeView !== 'orbital') return
```

Add import: `import { useModeStore } from '../state/mode'`

- [ ] **Step 3: Same for VehicleMarker.tsx**

In `src/render/VehicleMarker.tsx`, add at the top of the useFrame callback:

```typescript
if (useModeStore.getState().activeView !== 'orbital') return
```

Add import.

- [ ] **Step 4: Run typecheck + tests**

Run: `npm run check`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add src/render/Body.tsx src/render/OrbitTrace.tsx src/render/VehicleMarker.tsx
git commit -m "feat: gate orbital view useFrame callbacks when vehicle view is active"
```

---

### Task 12: Integration Test — Full System Smoke Test

**Files:**
- No new test files needed — run existing tests + manual verification

- [ ] **Step 1: Run full check suite**

Run: `npm run check`
Expected: typecheck PASS, lint PASS, all tests PASS

- [ ] **Step 2: Run dev server and verify manually**

Run: `npm run dev`

Verify:
1. Main menu loads, "Launch: Sun–Earth–Moon" button visible
2. Click launch → orbital view shows Sun, Earth, Moon orbiting
3. Vehicle marker (green diamond) visible near Earth
4. Can follow vehicle in orbital view (click "Orbiter" button)
5. Press V → switches to vehicle view (cylinder mesh, Earth visible below)
6. Press V → back to orbital view
7. Warp rates work in both views
8. Escape returns to menu cleanly

- [ ] **Step 3: Commit any fixes from integration testing**

```bash
git add -A
git commit -m "fix: integration testing fixes for vehicle in orbit"
```

---

### Task 13: Final Cleanup and Commit

- [ ] **Step 1: Remove dead code**

Check for any remaining references to old `EnvironmentPatch` type and remove them. Check `src/sim/vehicle/environment.ts` was updated in Task 2.

- [ ] **Step 2: Run final check**

Run: `npm run check`
Expected: all PASS

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "Milestone 2: vehicle in orbit with own worker, cube patches, dual canvas"
```
