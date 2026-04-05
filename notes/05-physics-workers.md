# Physics Workers

Status: **Decided**

## Core Principle

The simulation runs in Web Workers from day one. This enforces the sim/render boundary architecturally — you can't accidentally couple them because they're in different execution contexts.

## Three-Worker Architecture

There are at most three workers, each owning a different simulation domain:

```
ORBITAL WORKER
  Owns: celestial body state, n-body integration, atmosphere models, terrain generation
  Sends to vehicle workers: EnvironmentPatch (see 06-environment-patches.md)
  Sends to renderer: trajectory curves for celestial bodies
  Receives from main: warp commands

PLAYER VEHICLE WORKER
  Owns: player vessel — full fidelity per-part physics
  Receives from orbital: EnvironmentPatch (high resolution, frequent)
  Receives from main: player commands (throttle, attitude, staging)
  Sends to renderer: vehicle trajectory curve + part-level state (temps, fuel, stress)

NPC VEHICLE WORKER
  Owns: all other vessels — simplified aggregate models
  Receives from orbital: EnvironmentPatch (coarser, less frequent)
  Sends to renderer: vehicle trajectory curves
```

**Key simplification: vehicles have zero gravitational mass.** They are influenced by gravity but produce none. This makes the *physics* data flow one-directional — the orbital worker's n-body integration doesn't depend on vehicle state. However, the orbital worker does receive vehicle position updates (relayed through the bridge) so it knows where to generate environment patches. This is a bookkeeping dependency, not a physics dependency — it doesn't affect integration order or create circular computation.

**Each vehicle worker computes gravity locally** by summing `G*M/r²` from the body positions in the environment patch. This is ~20 multiplications vs. thousands of operations for per-part physics — trivial and avoids any round-trip to the orbital worker.

**Why not one worker per vehicle?** Web Workers are full isolates (own heap, own GC). Three is manageable. N is wasteful. The NPC worker runs simplified models for all non-player vessels — aggregate mass, basic drag, no thermal.

**Why not a single worker with staged pipeline?** This works fine initially and is the recommended starting point. The staged pipeline becomes the three-worker architecture by extracting the vehicle stage into its own worker — the interface between stages becomes the interface between workers. No redesign needed.

### Command Routing

The main thread routes commands to the appropriate worker:
- `set-warp` → orbital worker (sets the pace, vehicle workers follow)
- `set-throttle`, `stage`, `set-attitude` → player vehicle worker
- Camera, UI commands → stay on main thread

### Build Sequence

See the consolidated build sequence at the end of this document.

## Orbital Worker Inner Loop

```typescript
let state: OrbitalState          // celestial bodies only
let warpRate = 1
const DT = 1 / 60               // fixed physics timestep (seconds)

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'set-warp') {
    warpRate = msg.rate
  }
  if (msg.type === 'vehicle-positions') {
    // Relayed from main thread — used for environment patch generation
    updateVehicleTracking(msg.vehicles)
  }
}

function tick() {
  const stepsPerTick = warpRate
  for (let i = 0; i < stepsPerTick; i++) {
    integrate(state, DT)
    state.simTime += DT
  }

  // Generate trajectory curves for bodies whose curves are expiring
  const curves = generateExpiringCurves(state)
  if (curves.length > 0) {
    self.postMessage({ type: 'trajectories', simTime: state.simTime, curves })
  }

  // Generate environment patches for tracked vehicles that need them
  const patches = generateExpiringPatches(state)
  for (const patch of patches) {
    self.postMessage({ type: 'environment-patch', ...patch })
  }
}

setInterval(tick, 1000 / 60)
```

## Integrator

Start with basic Euler integration. Upgrade path: Störmer-Verlet (symplectic, energy-conserving) or RK4 for n-body. The integrator is a function that takes state + dt and returns new state — swappable without touching anything else.

## Output Protocol: Trajectory Curves

Rather than sending raw position snapshots every tick, the worker sends **trajectory curves** that the renderer evaluates locally. This is inspired by animation easing functions — the renderer doesn't need to understand physics, it just evaluates polynomials.

### Why Not Raw Snapshots?

At realistic entity counts (100-250 bodies including planetary moons, vehicles, debris), full snapshots at 60fps means ~2 MB/s through `postMessage`. Structured clone at that rate creates GC pressure and frame timing jitter. More importantly, linear interpolation between snapshots produces visually wrong motion — objects cut corners on orbital arcs instead of following curves.

### Cubic Hermite Splines

Given position and velocity at two endpoints, a cubic Hermite curve passes through both positions exactly, has correct velocity at both endpoints, and is C1 continuous (no velocity discontinuities between segments).

```typescript
// Given: p0, v0 at t0 and p1, v1 at t1
// s = (t - t0) / (t1 - t0), normalized to [0, 1]

function evaluateCurve(curve: TrajectoryCurve, t: number): [number, number, number] {
  const s = (t - curve.t0) / (curve.t1 - curve.t0)
  const s2 = s * s
  const s3 = s2 * s
  const dt = curve.t1 - curve.t0

  // Hermite basis functions
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2

  return [
    h00 * curve.p0[0] + h10 * dt * curve.v0[0] + h01 * curve.p1[0] + h11 * dt * curve.v1[0],
    h00 * curve.p0[1] + h10 * dt * curve.v0[1] + h01 * curve.p1[1] + h11 * dt * curve.v1[1],
    h00 * curve.p0[2] + h10 * dt * curve.v0[2] + h01 * curve.p1[2] + h11 * dt * curve.v1[2],
  ]
}
```

Cost: 4 multiplies + 3 adds per axis per frame. Trivial.

### Accuracy

A cubic Hermite approximating a 10-degree arc of a circular orbit has a maximum radial error of ~0.003% of the orbital radius. For Earth's orbit, that's ~5 km over a ~40-minute window. Visually indistinguishable. Errors don't accumulate because each new curve segment snaps to the worker's authoritative state.

### Parent-Relative Curves

Curves are expressed **relative to the parent body**, not in absolute coordinates. Europa's curve is relative to Jupiter. This:
- Keeps polynomial coefficients numerically small
- Means Jupiter's own motion doesn't invalidate Europa's curve
- Naturally mirrors the physics (moons orbit planets, not the Sun)
- Maximizes validity windows

The renderer composes hierarchically: evaluate Europa relative to Jupiter, evaluate Jupiter relative to Sun, transform to camera-relative for rendering.

### Validity Windows Replace Update Frequency

Instead of "planets update at 1Hz, vehicles at 60Hz," each curve carries a validity window. The worker decides how long each curve is good for based on how predictable the motion is:

| Entity state | Typical validity window |
|---|---|
| Planet in stable orbit | minutes to hours |
| Moon in stable orbit | minutes |
| Coasting vessel (no thrust) | seconds to minutes |
| Thrusting vessel | 0.1 - 1 second |
| SOI transition, close encounter | per-tick (very short curves) |

The renderer doesn't know or care why — it just evaluates the polynomial and waits for the next one.

### Graceful Degradation

If a curve expires before the worker sends a replacement (lag spike, heavy warp), the renderer can extrapolate past `t1`. A cubic extrapolation is wrong but smooth — far better than freezing or jumping.

### Worker Output Messages

```typescript
// Trajectory curves (sent when previous curves are expiring)
{
  type: 'trajectories',
  simTime: number,
  curves: [{
    id: string,
    parentId: string,                   // curve is relative to this body
    p0: [number, number, number],       // position at t0 (parent-relative)
    v0: [number, number, number],       // velocity at t0
    t0: number,                         // sim-time start
    p1: [number, number, number],       // position at t1
    v1: [number, number, number],       // velocity at t1
    t1: number,                         // sim-time end
  }, ...]
}

// Corrections for fast-changing entities (every tick, transferable buffer)
{
  type: 'active',
  simTime: number,
  entities: Float64Array,               // packed [id, px, py, pz, vx, vy, vz, ...]
}

// Simulation events
{
  type: 'event',
  event: SimEvent,                      // collision, SOI change, etc.
}
```

For active updates (thrusting vessels, close encounters), use transferable `Float64Array` — O(1) memory transfer, no structured clone, no GC pressure.

### SOI Collapse (Future)

Distant planetary systems the player isn't near can be collapsed to a single barycenter + mass for the renderer. The worker still simulates internally (for accuracy when the player eventually arrives), but only sends the renderer a single trajectory curve for the collapsed system. When the player approaches, the worker starts sending individual curves for that system's bodies. The renderer sees new entities appear and starts drawing them.

## Build Sequence (Workers + Output Protocol)

Two axes evolve together: worker architecture and output protocol.

1. **Milestone 1 (orbiting bodies):** Single worker. Full snapshots via transferable `Float64Array`. Proves coordinate system, floating origin, physics loop.
2. **Add trajectory curves:** Same single worker, but output switches from raw snapshots to Hermite curves with validity windows. Proves the curve evaluation pipeline.
3. **Add vehicles:** Single worker with staged pipeline (orbital stage + vehicle stage). Vehicle stage consumes environment patches from orbital stage. Proves domain separation.
4. **Extract player vehicle worker:** When part-level physics needs a higher timestep or is too expensive to share a thread. The interface between pipeline stages becomes the worker boundary.
5. **Add NPC vehicle worker:** When detached vessels / debris need their own simulation. Simplified models.
6. **SOI collapse:** When the solar system is fully populated. Collapse distant subtrees to barycenters for both simulation efficiency and communication.

## What Lives in the Workers

Everything in `sim/` — pure TypeScript, no React or Three.js imports. This means:
- Unit-testable with plain test runners
- No DOM dependencies
- Physics logic can't accidentally touch rendering
- Same code could run server-side for multiplayer
