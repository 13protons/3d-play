# Entities & Parts

Status: **Decided**

## Entity Types

There are three kinds of physical entities in the sim:

### Celestial Bodies
Point masses with gravitational influence, organized in a parent hierarchy. Owned by the orbital worker.

```typescript
// Runtime state in the orbital worker
interface CelestialBody {
  id: string
  name: string
  parentId: string | null               // null = root (the Sun)

  // Gravitational properties
  mass: number                          // kg
  radius: number                        // meters
  soiRadius?: number                    // meters

  // Orbital state (authoritative, absolute, updated by integrator)
  position: SectorPosition
  velocity: [number, number, number]    // m/s

  // Rotational state
  orientation: [number, number, number, number]  // quaternion — encodes axial tilt + current phase
  angularVelocity: number               // rad/s (scalar — always spins around own axis)

  // References
  atmosphereModel?: string              // key into atmosphere definitions
}
```

**Orientation** is a quaternion that encodes both axial tilt and current rotational phase. It's constructed at startup from the body definition's `axialTilt` (intrinsic, in degrees off orbital plane normal) and the scenario's `rotationPhase` (temporal, radians at epoch). Each tick, the orbital worker advances the orientation by integrating `angularVelocity` around the body's spin axis.

**Parent-relative positions** (needed for trajectory curves) are not stored on the runtime object. They're computed on demand by subtracting the parent's absolute position when generating curves. This avoids redundant state.

#### Body Hierarchy

Celestial bodies form a tree. Each body orbits its parent:

```
Sun (root, parentId: null)
├── Mercury
├── Venus
├── Earth
│   └── Moon
├── Mars
│   ├── Phobos
│   └── Deimos
├── Jupiter
│   ├── Io
│   ├── Europa
│   ├── Ganymede
│   └── Callisto
├── Saturn
│   ├── Titan
│   ├── Enceladus
│   └── ...
...
```

**Why parent-relative matters:**
- **Trajectory curves are parent-relative** (see [05-physics-workers.md](05-physics-workers.md)). The Moon's curve is relative to Earth, not the Sun. This keeps polynomial coefficients small and maximizes validity windows.
- **SOI logic** uses the hierarchy. A vessel near the Moon is in the Moon's SOI (child of Earth's SOI). The relevant environment patch comes from the Moon, not Earth.
- **SOI collapse** (for distant systems) collapses an entire subtree to its root's barycenter. The hierarchy defines what gets collapsed.
- **The n-body integrator still uses absolute positions** for gravity — the hierarchy doesn't change the physics, just the bookkeeping and communication.

Parent-relative positions are computed on demand when generating trajectory curves (subtract parent's absolute position). The orbital worker only stores absolute positions as authoritative state.

### Vessels
Collections of parts with a command module. Have agency — can thrust, stage, rotate. The player vessel is owned by the player vehicle worker (full fidelity). NPC/detached vessels are owned by the NPC vehicle worker (simplified model).

### Debris
Spent stages, decoupled parts without a command module. Still full vessels in the NPC vehicle worker (they need drag, heating, ablation — a spent booster reentering atmosphere should burn up, not follow a bare Keplerian arc). Flagged as debris and subject to cleanup criteria that controllable vessels are exempt from. See the Decoupling section below for details.

## No ECS

Plain TypeScript interfaces for sim data, React components for rendering. The worker boundary already enforces data/rendering separation. Entity counts are low enough (hundreds of parts, not thousands of autonomous entities) that ECS machinery would add complexity without benefit. If thousands of debris particles ever become a concern, a particle system is the answer, not ECS.

## Data-Driven Definitions

Part types and celestial bodies are defined in JSON data files, not code. Each entity is one file with sections organized by concern (physics, render, terrain, attach). Different consumers load only the sections they need.

See [04-entity-definitions.md](04-entity-definitions.md) for the full definition formats, the three-layer world data model (definitions → terrain generators → surface content), and the consumer-specific loader pattern.

## Vessel Structure: Part Tree

A vessel is a **tree of parts** rooted at the command module. Each part connects to its parent via an attachment point. This gives us:

- **Staging by subtree.** Decoupling at a node means cutting the branch — everything below separates. Naturally recursive.
- **Force propagation.** Thrust, drag, and structural loads propagate through the tree. Each node accumulates forces from its children.
- **Center of mass.** Walk the tree, sum mass × position. Changes as fuel drains.
- **Clean decoupling.** When a decoupler fires, detach the subtree. If the subtree contains a command module → new vessel. If not → debris.

```typescript
// A part instance placed in a vessel
interface PartInstance {
  instanceId: string                    // unique within this vessel
  defId: string                         // references a PartDef
  parentInstanceId: string | null       // null = root (command module)
  parentAttachPointId: string | null    // which attach point on the parent
  myAttachPointId: string               // which of my attach points is connected
  localPosition: [number, number, number]       // relative to parent part
  localRotation: [number, number, number, number]  // quaternion, relative to parent

  // Mutable state (changes during simulation)
  fuel?: number                         // current fuel mass (kg)
  temperature?: number                  // current temperature (K)
  stage: number                         // staging group (0 = first to fire)
  active: boolean                       // is this part currently active (engine firing, etc.)
}
```

## Vessel Physics Data

What the vehicle worker actually operates on:

```typescript
interface VesselPhysics {
  id: string
  parts: PartInstance[]                 // the part tree (parent references form the tree)
  position: SectorPosition
  velocity: [number, number, number]    // m/s
  orientation: [number, number, number, number]   // quaternion
  angularVelocity: [number, number, number]       // rad/s
  currentStage: number                  // which stage is next to fire
}
```

### Derived Properties (computed each tick, not stored)

```typescript
interface VesselDerived {
  totalMass: number                     // sum of dry mass + fuel across all parts
  centerOfMass: [number, number, number] // relative to root part
  momentOfInertia: [number, number, number, number, number, number, number, number, number]  // 3×3 tensor
  netThrustVector: [number, number, number]   // sum of active engines, in vessel frame
  netDragVector: [number, number, number]     // from compound drag surface
  windwardArea: number                  // aggregate cross-sectional area for drag
}
```

These are recomputed each physics tick because fuel drain changes mass, CoM, and moment of inertia continuously. The computation walks the part tree once per tick — for 100 parts, this is negligible.

## Decoupling: Hybrid by Part Type

When a decoupler fires:

1. Cut the part tree at the decoupler node. The subtree below detaches.
2. Scan the detached subtree for a **command module** (any part with `command` capability).
3. **If command module found → controllable vessel.** Assign it an ID, compute its initial position/velocity/orientation from the parent vessel's state + the subtree's position in the part tree. Hand it to the NPC vehicle worker. Not subject to cleanup.
4. **If no command module → debris vessel.** Same as above — still a vessel in the NPC vehicle worker with part-level physics (drag, heating, ablation). But flagged as debris and subject to cleanup criteria.
5. Apply ejection force to both pieces (equal and opposite).

**Both types are NPC vessels in the same worker.** Debris still needs vehicle physics — a spent booster reentering atmosphere should experience drag and heating, not follow a bare Keplerian arc. The NPC worker may run simplified models for debris (coarser environment patches, less frequent updates) but they're still real vehicles with parts.

### Debris vs. Controllable Vessels

The only differences between debris and a controllable vessel:

| | Controllable vessel | Debris vessel |
|---|---|---|
| Command module | Has one | Doesn't |
| Player can switch to it | Yes (future) | No |
| Receives commands | Yes (from player or AI) | No (ballistic + physics only) |
| Subject to cleanup | No | Yes |
| Fidelity level | Full or simplified | Simplified |

### Debris Cleanup Criteria

Debris vessels are garbage collected when:
- Surface impact (altitude < terrain height)
- Escaped the relevant SOI by a large margin
- Distance from player exceeds a threshold
- Global debris count limit reached (remove oldest/farthest first)

Controllable vessels are **never** automatically cleaned up, even if they meet the same distance/count criteria.

## Part-to-Physics Pipeline

The editor (future) produces a visual assembly of parts. The **serialization boundary** between editor and flight is the `VesselPhysics` structure:

```
EDITOR                           FLIGHT
┌──────────────────────┐        ┌──────────────────────────────┐
│ Visual assembly       │        │ VesselPhysics                │
│ (React components,    │───────▶│ (pure data, sent to vehicle  │
│  3D transforms,       │ serialize  worker)                    │
│  snap-to-attach)      │        │                              │
└──────────────────────┘        └──────────────────────────────┘
```

The editor works with visual representations (meshes, 3D gizmos). On "launch," it serializes to `VesselPhysics` — part tree with positions, rotations, fuel levels, staging groups. The vehicle worker loads part definitions (from JSON) and combines them with the instance data to simulate.

## Structural Integrity (Future)

For now, vessels are **rigid bodies**. All parts are welded. No joint flex, no breakage.

The part tree structure supports adding joint constraints later:
- Each parent-child connection becomes a joint with a break force
- The vehicle worker runs a constraint solver to propagate loads through the tree
- When load exceeds break force, the joint breaks → same as decoupling (subtree detaches)

This is a significant physics feature (essentially a real-time constraint solver) and should be its own design doc when the time comes. The part tree doesn't need to change — it's already the right data structure for this.
