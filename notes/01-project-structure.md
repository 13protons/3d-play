# Project Structure

Status: **Decided**

## Directory Layout

```
data/
├── bodies/                       ← One JSON per celestial body (intrinsic properties)
│   ├── sun.json
│   ├── earth.json
│   ├── moon.json
│   └── ...
├── parts/                        ← One JSON per part type (physics, render, attach sections)
│   ├── mk1-command-pod.json
│   ├── lv-t30-engine.json
│   └── ...
└── scenarios/                    ← Initial state: which bodies to load, positions at epoch
    ├── full-solar-system.json
    ├── sun-earth-moon.json
    └── ...

src/
├── sim/                      ← Pure TypeScript. No React/Three imports.
│   ├── orbital/                   Orbital mechanics domain
│   │   ├── worker.ts                  Orbital worker entry point
│   │   ├── integrator.ts             N-body integration (Euler → Verlet → RK4)
│   │   ├── gravity.ts                Gravitational acceleration
│   │   └── atmosphere.ts             Atmospheric density/temperature models
│   │
│   ├── vehicle/                   Vehicle physics domain
│   │   ├── worker.ts                  Vehicle worker entry point
│   │   ├── parts.ts                   Per-part physics (fuel flow, thermal, stress)
│   │   ├── drag.ts                    Compound drag surface calculation
│   │   ├── thrust.ts                  Engine thrust, gimbal, staging
│   │   └── environment.ts            Evaluate EnvironmentPatch (density, terrain, gravity)
│   │
│   ├── types.ts                   Shared types (SectorPosition, Command, TrajectoryCurve,
│   │                                EnvironmentPatch, SimBody, VesselPhysics)
│   ├── coordinates.ts             SectorPosition, normalize, relativePosition, toRenderFrame
│   ├── curves.ts                  Hermite spline evaluation
│   ├── terrain.ts                 Terrain generators (pure math, shared by orbital worker + renderer)
│   └── constants.ts               G, AU, body masses, radii
│
├── state/                    ← Zustand stores + worker bridge
│   ├── trajectories.ts           Trajectory curves (from all workers → renderer)
│   ├── vehicle.ts                Part-level state (fuel, temps, stress → HUD)
│   ├── camera.ts                 Floating origin, follow target
│   ├── mode.ts                   Game mode state machine
│   ├── input.ts                  Commands buffer
│   └── bridge.ts                 Worker management, message routing, command dispatch
│
├── render/                   ← R3F components. Consume stores.
│   ├── Scene.tsx                  Top-level Canvas + floating origin logic
│   ├── Body.tsx                   Renders a celestial body (sphere + effects)
│   ├── Vessel.tsx                 Renders a vessel (part meshes)
│   ├── OrbitLine.tsx              Projected orbit path
│   ├── CameraRig.tsx             Camera controllers per mode
│   └── SkyBox.tsx                 Background stars
│
├── modes/                    ← Top-level screens
│   ├── Flight.tsx                 Simulation view (renders Scene + HUD)
│   ├── Editor.tsx                 Part assembly (future)
│   └── MapView.tsx                Orbital map (future)
│
├── ui/                       ← HTML/CSS overlay (not 3D)
│   ├── HUD.tsx                    Speed, altitude, warp, fuel, temps
│   └── MainMenu.tsx               Mode selection
│
├── App.tsx                   ← Mode router
└── main.tsx                  ← Entry point
```

## Critical Boundaries

### `sim/` never imports from React or Three.js

This is the most important architectural rule. It keeps physics:
- **Testable** — plain unit tests, no DOM or WebGL mocking
- **Worker-compatible** — runs in a Web Worker without polyfills
- **Renderer-independent** — could swap Three.js for something else without touching physics
- **Server-portable** — same code could run in Node.js for multiplayer authoritative sim

### `sim/orbital/` and `sim/vehicle/` don't import each other

They share types via `sim/types.ts` but have no direct dependency. The orbital domain doesn't know vehicles exist. The vehicle domain doesn't know how atmosphere or terrain is generated — it only evaluates `EnvironmentPatch` data. This is what makes the single-worker → three-worker extraction possible without redesign.

### The renderer doesn't know about physics

It evaluates trajectory curves (polynomials) and reads part state from stores. It doesn't import from `sim/orbital/` or `sim/vehicle/`. The only `sim/` imports are shared foundation code: types, `curves.ts` (Hermite evaluator), and `terrain.ts` (deterministic terrain generators for visual LOD).

## Module Dependencies

```
sim/types.ts, sim/coordinates.ts, sim/curves.ts, sim/terrain.ts, sim/constants.ts
    ↑                    ↑                   ↑                ↑
    │                    │                   │                │
sim/orbital/        sim/vehicle/         state/           render/
(imports types      (imports types       (imports types   (imports types
 + coordinates       + coordinates        + curves)        + curves
 + constants         + constants)             ↑            + terrain)
 + terrain)                                   │                ↑
                                          render/  ←  ui/      │
                                              ↑                │
                                          modes/───────────────┘
                                              ↑
                                           App
```

The dependency graph is acyclic. `sim/orbital/` and `sim/vehicle/` are leaf modules that share foundation code but don't depend on each other. `render/` imports shared foundation code (`curves.ts`, `terrain.ts`) but never imports from `sim/orbital/` or `sim/vehicle/`. Everything flows upward from the sim foundations through state and into rendering.

## Data Flow Summary

```
sim/orbital/worker  ──trajectory curves──▶  state/bridge  ──▶  state/trajectories  ──▶  render/
                    ──EnvironmentPatch───▶  state/bridge  ──relay──▶  sim/vehicle/worker
                                                                      ──trajectory curves──▶  state/bridge  ──▶  state/trajectories  ──▶  render/
                                                                      ──part state────────▶  state/bridge  ──▶  state/vehicle  ──▶  ui/HUD
                                                                      ──position updates──▶  state/bridge  ──relay──▶  sim/orbital/worker

state/input  ──commands──▶  state/bridge  ──routes to──▶  appropriate worker

All inter-worker communication routes through state/bridge on the main thread.
```
