# Warp Architecture: Bridge-Owned Clock + Adaptive Integration

## Problem

The current warp implementation brute-forces `warpRate` fixed Störmer-Verlet substeps (DT=1/60) per frame tick. At 100,000x warp, that's 100,000 substeps per frame — expensive, numerically questionable, and the independent worker clocks drift apart causing orbital instability.

The vehicle orbit goes haywire at high warp because:
1. Workers use independent `setTimeout` loops that drift relative to each other
2. The vehicle worker races ahead of the orbital worker, causing gravity source predictions to extrapolate too far
3. Fixed-step integration wastes compute on smooth orbital arcs where huge steps would suffice

## Constraints

- **Real n-body physics at every warp level.** No "on rails" / Kepler propagation. Lagrange points, perturbations, resonances, and three-body capture must work.
- **No thrust or vehicle attitude at warp.** Vehicle is a passive point mass in an n-body gravity field during warp. Engines and attitude control are disabled.
- **Warp changes take effect on the next batch.** Current batch completes, then the new rate applies. One or two frames of transition is acceptable.
- **Both workers share the same adaptive integrator** with different force functions.

## Design

### 1. Bridge-Owned Clock

The bridge (main thread) becomes the single source of truth for simulation time. Workers lose their `setTimeout` tick loops entirely and become reactive — they respond to `advance` messages from the bridge.

**Bridge animation frame loop:**
```
requestAnimationFrame:
  wallDelta = timeSinceLastFrame (seconds, typically ~0.0167)
  simDelta = wallDelta × warpRate
  targetTime = simTime + simDelta
  
  if orbitalWorker is idle:
    send { type: 'advance', targetTime } to orbitalWorker
    mark orbitalWorker as busy
  
  // renderer interpolates existing curves at 60fps regardless
```

**Key rules:**
- Workers have no `setTimeout` loop. They respond to `advance` messages.
- Bridge computes `targetTime = simTime + wallDelta × warpRate` each animation frame.
- Workers choose their own internal step sizes. Bridge doesn't know or care about dt.
- Workers report back trajectory curves covering `[oldTime, targetTime]`.
- Bridge only sends `advance` to idle workers — no queue buildup.
- Warp changes just change the bridge's `warpRate`. Next frame uses the new rate.

### 2. Adaptive Integrator (Dormand-Prince 4/5)

Replace the brute-force fixed-step loop with an adaptive Runge-Kutta integrator that automatically selects step sizes based on local error estimation.

**Interface:**
```typescript
type DerivFn = (t: number, y: Float64Array, dydt: Float64Array) => void

function advanceTo(
  y: Float64Array,      // state vector [x,y,z,vx,vy,vz, ...]
  t0: number,           // current time
  t1: number,           // target time
  deriv: DerivFn,       // computes derivatives (accelerations)
  tol: number,          // error tolerance (e.g., 1e-10)
): { y: Float64Array, steps: number }
```

**Algorithm:** Dormand-Prince embedded RK4(5) with FSAL property:
- 7 stages per step, but FSAL (First Same As Last) means effectively 6 force evaluations
- Computes both a 4th-order and 5th-order solution per step
- Error estimate = |y5 - y4|, used to accept/reject and resize the step
- Step control: `dt_new = dt × 0.9 × (tol / err)^0.2`
- Rejected steps retry with smaller dt; accepted steps grow dt for next step
- Final step is clamped to land exactly on `targetTime`

**Performance comparison for one LEO orbit (~90 min):**
- Fixed Verlet at DT=1/60: **324,000 steps**, 648,000 force evaluations
- Adaptive RK45 at ε=10⁻¹⁰: **~100–300 steps**, ~600–1,800 force evaluations

At 100,000x warp, one frame covers ~28 orbits ≈ **~6,000 adaptive steps** instead of ~9 billion fixed steps.

**Energy conservation:** Dormand-Prince is not symplectic, so energy drifts slowly. At ε=10⁻¹⁰, drift is ~10⁻¹⁰ per orbit. Over 10,000 orbits (2 years of LEO): ~10⁻⁶ relative error. Invisible for any gameplay timescale.

**Shared by both workers:** The orbital worker passes `nBodyAcceleration(bodies)` as the derivative function. The vehicle worker passes `pointMassAcceleration(gravitySources)`. Same integrator, different physics.

### 3. Data Flow & Batch Pacing

The bridge orchestrates a sequential pipeline per batch: orbital first, then vehicle.

**Per-batch sequence:**
```
1. Bridge sends { type: 'advance', targetTime: T } to orbital worker
2. Orbital worker integrates all bodies from t0 to T using adaptive RK45
3. Orbital worker returns trajectory curves for all bodies covering [t0, T]
4. Bridge stores orbital curves, updates renderer
5. Bridge sends { type: 'advance', targetTime: T, bodyCurves: [...] } to vehicle worker
6. Vehicle worker evaluates gravity by interpolating orbital body curves at each step
7. Vehicle worker returns vehicle trajectory curve covering [t0, T]
8. Bridge stores vehicle curve, updates renderer
9. Bridge marks both workers as idle, ready for next batch
```

**Vehicle gravity from orbital curves:** The vehicle worker receives the orbital worker's body trajectory curves for the current batch. At each adaptive step, it evaluates body positions by interpolating these curves at the current simTime. This gives exact body positions (matching the orbital integration) with no prediction, no drift, and no stale data.

**Low warp (1x–10x):** Batch covers a small sim-time delta (0.017–0.17 seconds per frame). Workers complete within one frame. Effectively per-frame updates.

**High warp (10,000x+):** Batch covers a large sim-time delta (167+ seconds per frame). Workers may take 2–5 frames to compute. Renderer interpolates existing curves smoothly at 60fps. No stutter — the HUD sim-time advances by extrapolating the last curve.

**Batch pacing:** Bridge only sends the next `advance` when both workers have completed the previous batch. This prevents queue buildup and ensures the orbital worker is always ahead of the vehicle worker.

### 4. Worker Message Protocol

**Orbital worker inbound:**
```typescript
| { type: 'init', bodies: InitBody[] }
| { type: 'advance', targetTime: number }
| { type: 'set-warp', rate: number }  // informational, for future use
```

**Orbital worker outbound:**
```typescript
| { type: 'trajectories', simTime: number, curves: TrajectoryCurve[] }
  // simTime >= targetTime signals batch complete. Bridge marks worker idle.
```

**Vehicle worker inbound:**
```typescript
| { type: 'init', vehicle: VehicleInit, gravitySources: GravitySource[] }
| { type: 'advance', targetTime: number, bodyCurves: TrajectoryCurve[] }
| { type: 'set-warp', rate: number }  // informational, for future use
```

**Vehicle worker outbound:**
```typescript
| { type: 'vehicle-trajectories', simTime: number, curves: TrajectoryCurve[] }
  // simTime >= targetTime signals batch complete. Bridge marks worker idle.
```

### 5. State Vector Layout

The adaptive integrator operates on a flat `Float64Array` state vector. Each worker packs its state into this format.

**Orbital worker (N bodies):**
```
[x0, y0, z0, vx0, vy0, vz0,   // body 0
 x1, y1, z1, vx1, vy1, vz1,   // body 1
 ...                            // 6N elements total
]
```

**Vehicle worker (1 vehicle):**
```
[x, y, z, vx, vy, vz]          // 6 elements
```

The derivative function writes accelerations into the corresponding velocity slots of `dydt`.

### 6. Curve Emission

Workers emit trajectory curves after completing each batch. The curve format is unchanged from the current design (cubic Hermite splines with position + velocity at two endpoints).

At low warp, one curve per body per frame. At high warp, one curve per body per batch (covering a larger time span). The renderer interpolates identically in both cases.

For very large batches (high warp), workers may emit **intermediate curves** within the batch to keep the renderer fed. The bridge can request this via a `maxCurveSpan` parameter — if the batch covers more sim-time than `maxCurveSpan`, the worker emits multiple shorter curves. This gives the renderer finer interpolation data for long arcs.

### 7. Existing Code Preservation

- **`cube-patch.ts`**: Preserved for future atmosphere/terrain patches. Not used for gravity.
- **`evaluateGravity`**: Fixed (1/3 gradient bug), kept for future environment sampling.
- **Störmer-Verlet integrator**: Kept in `sim/orbital/integrator.ts` for future use (thrust, drag). Not used during warp.
- **`kepler.ts`**: Kept for orbit visualization (predicted orbit lines). Not used for physics propagation.
- **Warp rates**: `WARP_RATES` in `warp.ts` unchanged. The bridge uses these to set `warpRate`.

## File Changes

| File | Change |
|------|--------|
| `src/sim/integrator/adaptive.ts` | **New.** Dormand-Prince 4/5 adaptive integrator. |
| `src/sim/orbital/worker.ts` | Remove `setTimeout` loop. Add `advance` message handler. Pack/unpack state vector. Use adaptive integrator. |
| `src/sim/vehicle/worker.ts` | Remove `setTimeout` loop. Add `advance` message handler with `bodyCurves`. Evaluate gravity from curves. Use adaptive integrator. |
| `src/state/bridge.ts` | Own the clock. `requestAnimationFrame` loop computes targetTime. Sequential dispatch: orbital → vehicle. Track worker idle/busy state. |
| `src/sim/types.ts` | Update worker message types per protocol above. |
| `src/sim/vehicle/integrate.ts` | Keep `GravityFn` interface. Vehicle worker creates gravity function from body curves. |
| `src/sim/__tests__/adaptive.test.ts` | **New.** Tests for adaptive integrator: step control, error bounds, energy conservation. |
| `src/sim/__tests__/orbital-dynamics.test.ts` | Update to use adaptive integrator. Add high-warp energy conservation tests. |

## Out of Scope

- Thrust / attitude control during warp (engines are off at warp)
- Atmosphere / terrain cube patches (future milestone)
- Multiple vehicles (future milestone)
- Collision detection during warp (future)
- Switching between Verlet and adaptive based on thrust state (future)
