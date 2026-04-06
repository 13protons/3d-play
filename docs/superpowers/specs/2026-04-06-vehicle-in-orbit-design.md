# Milestone 2: Vehicle in Orbit

A passive vehicle orbiting Earth under gravity, rendered in both an orbital overview and a vehicle-perspective view, with physics running in its own web worker fed by cube-shaped environment patches from the orbital worker.

## Scope

**In scope:**
- Vehicle worker: Störmer-Verlet integration for a single zero-mass body, gravity from cube patch
- Cube patch pipeline: orbital worker generates gravity patches, bridge mediates refresh cycle
- Dual canvas: orbital view (existing, extended) + vehicle view (new)
- Vehicle in scenario data: position/velocity in LEO added to sun-earth-moon scenario
- View toggle: V key + HUD button to switch between orbital and vehicle views

**Out of scope:**
- Vehicle controls (throttle, attitude, staging)
- Part tree / multi-part vessels
- Atmosphere and terrain data in patches
- Terrain loader system
- Map view (separate from orbital view)
- NPC vehicle worker
- Editor mode

## Inter-Worker Data Flow

Three actors: orbital worker, vehicle worker, bridge (main thread). Workers never communicate directly — the bridge relays everything.

### Message flow per tick

1. Orbital worker integrates bodies, emits body trajectory curves → bridge
2. Vehicle worker integrates vehicle using current cube patch, emits vehicle trajectory curve + absolute position → bridge
3. Bridge writes all trajectories (bodies + vehicle) to the trajectories Zustand store
4. Bridge checks: is vehicle position still inside the inner box of the current cube patch?
5. If NO → bridge computes new cube bounds from vehicle trajectory + warp rate, sends `request-patch` (6 face-center sample points) to orbital worker
6. Orbital worker evaluates gravity at each sample point from its body state, returns values → bridge
7. Bridge assembles the cube patch (bounds + face values) and relays to vehicle worker

### New message types

| Message | Direction | Payload |
|---------|-----------|---------|
| `cube-patch` | orbital → bridge → vehicle | Float64Array(24) — gravity cube |
| `request-patch` | bridge → orbital | 6 sample points (face centers of bridge-defined cube) |
| `vehicle-position` | vehicle → bridge | absolute position (for bridge monitoring) |
| `vehicle-trajectories` | vehicle → bridge | TrajectoryCurve for the vehicle |

### Key principles

- Vehicle worker never sees raw body positions — only evaluated cube patches
- Orbital worker generates patches — it owns the world model
- Bridge decides when to refresh — neither worker tracks staleness
- Workers are decoupled: orbital worker doesn't know vehicles exist for integration; vehicle worker doesn't know where patches come from

## Cube Patch Format

### The AOI cube as a spatial query

The cube patch is not just an inter-worker message — it's a spatial query that multiple systems can respond to. The **bridge** defines the cube based on the vehicle's trajectory and warp rate, then broadcasts it to relevant systems. Neither worker knows the cube exists as a concept — the orbital worker receives sample points to evaluate, and the vehicle worker receives a flat array of field data with bounds.

For this milestone, only the orbital worker responds (gravity). In the future:
- **Orbital worker** → gravity vectors, basic atmosphere model (smooth fields, cheap math)
- **Terrain loader** → heightmaps, surface detail (expensive, only near surface, separate message)
- **Object loader** → buildings, structures (very localized, future)

The vehicle worker doesn't know or care how many systems contributed to its patch. The bridge merges responses before forwarding.

### Wire format: flat typed array

Gravity and atmosphere data use a flat `Float64Array` transferred zero-copy via `postMessage`. No JSON serialization, no structured clone overhead.

**Gravity patch layout (24 floats, 192 bytes):**

| Index | Field |
|-------|-------|
| 0–2 | Box min (x, y, z) |
| 3–5 | Box max (x, y, z) |
| 6–8 | Gravity at −X face center |
| 9–11 | Gravity at +X face center |
| 12–14 | Gravity at −Y face center |
| 15–17 | Gravity at +Y face center |
| 18–20 | Gravity at −Z face center |
| 21–23 | Gravity at +Z face center |

Named constants in a shared `src/sim/cube-patch.ts` file (e.g., `CP_G_NEG_X = 6`) so both workers use readable index names.

The layout is append-only: future atmosphere density (6 floats) appends at indices 24–29, temperature at 30–35. Old consumers ignore extra bytes.

**Terrain is a separate message** — heightmap grids are 4–16 KB, fundamentally different from the ~200 byte field patches. Independent refresh thresholds, potentially from a different source system entirely. Not implemented in this milestone.

### Evaluation

The vehicle worker evaluates gravity at its position by normalizing to [0, 1] within the cube and lerping between opposing face values:

```
tx = (pos.x - min.x) / (max.x - min.x)
ty = (pos.y - min.y) / (max.y - min.y)
tz = (pos.z - min.z) / (max.z - min.z)

gX = lerp(gravity.negX, gravity.posX, tx)
gY = lerp(gravity.negY, gravity.posY, ty)
gZ = lerp(gravity.negZ, gravity.posZ, tz)

g = (gX + gY + gZ) / 3
```

Same math works for any scalar or vector field (density, temperature). The evaluation function doesn't know what it's interpolating.

### Cube sizing

The cube is world-axis-aligned. Side length scales with vehicle speed:

```
sideLength = speed × warpRate × dt × safetyMultiplier
```

Example: LEO at 7,700 m/s, warpRate=60, dt=1/60s, multiplier=4 → ~30 km cube.

Floor: 1 km minimum (prevents degenerate cubes at very low speed). No hard ceiling — larger cubes are naturally coarser, self-limiting.

### Validity zones

The cube defines its own validity boundary — no separate tracking system.

- **Inner box (request zone):** 50% inset from each face (half the side length). When the vehicle exits this box, the bridge requests a new patch.
- **Outer box (the cube itself):** Hard stale boundary. Data beyond here is unreliable. In normal operation, a new patch arrives before the vehicle reaches the outer boundary.

The outer radius is 2× the inner radius (in side length, not volume), providing comfortable buffer even during burns that change the vehicle's speed.

"Am I in the box?" is 6 comparisons — cheaper than a distance check.

## Vehicle Worker

### Responsibilities

- Receive init message with vehicle position, velocity, and initial cube patch
- Run Störmer-Verlet integration each tick using gravity evaluated from the cube patch
- Emit trajectory curve (same `TrajectoryCurve` format as celestial bodies) + absolute position
- Receive new cube patches when the bridge sends them
- Receive vehicle commands (future: throttle, attitude, stage — not this milestone)

### Integration

Same Störmer-Verlet algorithm as the orbital worker, but for a single zero-mass body. Gravity comes from `evaluateCubePatch()` instead of n-body gravitational acceleration. The worker is deliberately minimal — roughly 50 lines of integration loop + cube evaluation.

### Tick scheduling

Same self-scheduling `setTimeout(tick, 1000/60)` pattern as the orbital worker. Runs `warpRate` integration steps per tick.

## Dual Canvas Rendering

### Architecture

Two R3F `<Canvas>` components, both mounted when entering flight mode. The inactive canvas is hidden via `display: none` and its `useFrame` callbacks are gated by an active boolean — zero GPU cost.

Toggle via `V` key or HUD button. Mode store extended with `activeView: 'orbital' | 'vehicle'`.

Both canvases read the same trajectories Zustand store. No data duplication.

### Orbital canvas (existing, extended)

Everything from milestone 1 plus:
- Vehicle rendered as a screen-space marker (fixed-size dot/diamond, visible regardless of zoom)
- Vehicle added to follow-target list (camera can follow it)
- Vehicle orbit trace

Camera: far view, follows selected body or vehicle. Near: 1000, far: 1e15.

### Vehicle canvas (new)

- **Vehicle mesh:** simple cylinder, centered in view
- **Celestial bodies:** everything in the vehicle's celestial hierarchy — parent body, ancestors up to root, and all children of each ancestor. In Earth orbit: Earth + Moon + Sun. Positioned via trajectory curves relative to the vehicle (floating origin centered on vehicle).
- **Stars:** background starfield
- **Lighting:** point light at Sun's position
- **Camera:** close chase cam, ~50m behind vehicle. Near: 0.1, far: 1e9.
- **No orbit traces** (too close to see orbital paths)
- **OrbitControls** for manual camera rotation around the vehicle

### Body visibility rule

The vehicle canvas renders bodies from the vehicle's **celestial hierarchy tree**: its parent body, that parent's parent (recursively to root), and all direct children of each ancestor. This ensures:
- In Earth orbit: Earth (parent), Sun (grandparent), Moon (sibling via Earth)
- In Moon orbit: Moon (parent), Earth (grandparent), Sun (great-grandparent), no Jupiter
- Scales naturally with the body tree without rendering distant irrelevant bodies

## Scenario Data

Extend `sun-earth-moon.json` with a vehicle entry:

```json
{
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

Position: ~400km altitude (Earth radius 6,371 km + 400 km). Velocity: ~7,670 m/s for circular orbit at that altitude.

## State Changes

### Mode store

Add `activeView: 'orbital' | 'vehicle'` to flight state. Default to `'orbital'` on flight entry.

### Camera store

The existing `followTargetId` + `setFollowTarget` work for both canvases. The vehicle canvas ignores it (always follows the vehicle). The orbital canvas uses it as before, with the vehicle added to the target list.

### Bridge

- Spawn vehicle worker alongside orbital worker in `startSim()`
- Forward vehicle trajectory curves to trajectories store
- Monitor vehicle position against current cube patch inner box
- Request new patches from orbital worker when needed
- Route vehicle commands (future) to vehicle worker
- Terminate vehicle worker in `stopSim()`

### Trajectories store

No structural changes — vehicle trajectory curves use the same `TrajectoryCurve` type as bodies. The vehicle just appears as another entry in `curves`. Body metadata (`BodyMeta`) extended or a parallel `VehicleMeta` type added for the vehicle's render info.

## Types Changes

### Replace EnvironmentPatch

The existing `EnvironmentPatch` type in `src/sim/types.ts` is replaced by the cube patch system. The flat `Float64Array` layout is documented in a shared `src/sim/cube-patch.ts` file with named index constants and evaluation functions.

### New worker message types

Add to `src/sim/types.ts`:
- `VehicleWorkerInbound`: `'init'` | `'cube-patch'` | `'set-warp'` | vehicle commands (future)
- `VehicleWorkerOutbound`: `'vehicle-trajectories'` | `'vehicle-position'`
- `OrbitalWorkerInbound`: extended with `'request-patch'`
- `OrbitalWorkerOutbound`: extended with `'cube-patch'`
