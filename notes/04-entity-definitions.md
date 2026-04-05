# Entity Definitions

Status: **Decided**

## Core Principle

Entity definitions (bodies, parts) are **single files per entity** with sections organized by concern. Different consumers load only the sections they need. The file is the source of truth; the loader is the boundary.

## Three Layers of World Data

### Layer 1: Entity Definitions (small, loaded at startup)

One JSON file per celestial body or part type. Describes **intrinsic properties only** — what the entity IS, not where it is.

```
data/
├── bodies/
│   ├── sun.json
│   ├── earth.json
│   ├── moon.json
│   ├── mars.json
│   └── ...
├── parts/
│   ├── mk1-command-pod.json
│   ├── lv-t30-engine.json
│   ├── fl-t400-fuel-tank.json
│   └── ...
└── scenarios/
    ├── full-solar-system.json
    ├── sun-earth-moon.json        ← quick test: just 3 bodies
    ├── three-body-lagrange.json   ← n-body stability test
    └── ...
```

### Scenarios (initial state, separate from definitions)

A scenario file specifies **which bodies to load and where they start**. Body definitions are intrinsic; scenarios are positional. This separation means:
- The same body definitions can be used across different scenarios
- Quick test scenarios load a subset of bodies (Sun + Earth + Moon) without touching the full solar system
- Different starting epochs, hypothetical systems, or test configurations are just different scenario files
- Vessel starting conditions (orbit, surface, position relative to a body) live here too

```typescript
interface Scenario {
  id: string
  name: string
  description?: string
  epoch: number                         // sim-time at start (0 or a real epoch like J2000)

  bodies: {
    [bodyId: string]: {                 // references a body definition file
      position: SectorPosition          // absolute position at epoch
      velocity: [number, number, number] // m/s at epoch
      rotationPhase: number             // radians — where in daily rotation at epoch
    }
  }

  vessels?: [{
    id: string
    parts: PartInstance[]               // the part tree
    bodyId: string                      // initial SOI
    altitude?: number                   // meters above surface (for orbit starts)
    surfacePosition?: { lat: number; lon: number }  // for surface starts
    velocity?: [number, number, number] // m/s relative to parent body
  }]
}
```

The orbital worker loads body definitions for intrinsic properties, then applies the scenario to set initial positions. The scenario is the only file that knows "the solar system looks like this at time zero."

### Layer 2: Terrain Generators (code, deterministic)

Pure math functions that produce heightmaps: `(seed, lat, lon, resolution) → heights`. Referenced by body definitions via a generator key + parameters.

Generators are **code, not data** — `"rocky-wet"`, `"gas-giant"`, `"ice-moon"`, etc. They live in `sim/` because both the orbital worker (for environment patches) and the renderer (for visual terrain LOD) need them. Deterministic: same inputs = same output. No divergence between physics and visuals.

### Layer 3: Surface Content (spatial, streamable, large)

Buildings, launch pads, oceans, biome maps, points of interest. **Not loaded at startup.** Streamed when the player approaches a body's surface. Organized spatially (quadtree tiles or similar).

Could be procedural (biome derived from latitude + elevation + noise) or hand-placed (a launch facility at specific coordinates). This layer grows with gameplay and is potentially very large.

The physics worker never touches Layer 3 directly. If surface structures affect collision, they arrive through the environment patch as additional collision geometry — the worker doesn't know where they came from.

## Celestial Body Definition Format

```typescript
interface BodyDef {
  id: string
  name: string
  parentId: string | null

  physics: {
    mass: number                        // kg
    radius: number                      // meters (shared with render)
    axialTilt: number                   // degrees off orbital plane normal (shared with render)
    angularVelocity: number             // rad/s, scalar (spin speed around own axis)
    soiRadius?: number                  // meters
  }

  atmosphere?: {
    model: string                       // "exponential", "layered", etc.
    surfaceDensity: number              // kg/m³
    scaleHeight: number                 // meters
    surfaceTemperature: number          // K
    surfacePressure: number             // Pa
    composition?: string                // for future chemistry
    // Additional model-specific parameters
  }

  terrain?: {
    generator: string                   // "rocky-wet", "rocky-dry", "ice-moon", etc.
    seed: number
    maxElevation: number                // meters above mean radius
    minElevation: number                // meters below mean radius (ocean floors, canyons)
    // Additional generator-specific parameters
  }

  render: {
    albedo: string                      // color or texture reference
    luminosity?: number                 // for stars
    emissive?: boolean
    atmosphereColor?: string            // scattering tint
    atmosphereScale?: number            // visual thickness
    ringSystem?: {
      innerRadius: number
      outerRadius: number
      texture: string
    }
    // Surface visual parameters (distinct from terrain geometry)
    surfaceTint?: string
    cloudLayer?: { texture: string; speed: number }
  }
}
```

## Part Definition Format

```typescript
interface PartDef {
  id: string
  name: string
  category: string                      // "engine", "fuel", "structural", "command", "utility"

  physics: {
    mass: number                        // kg (dry mass)
    dragCoeff: number
    heatTolerance: number               // K

    fuel?: {
      capacity: number                  // kg
      fuelType: string
    }
    engine?: {
      thrust: number                    // Newtons (vacuum)
      isp: number                       // seconds
      fuelConsumption: number           // kg/s at full throttle
      gimbalRange?: number              // degrees
    }
    command?: {
      crewCapacity: number
      sasCapable: boolean
    }
    decoupler?: {
      ejectionForce: number             // Newtons
    }
  }

  attach: {                             // shared — both physics (structure) and render (mesh placement)
    points: AttachPoint[]
  }

  render: {
    meshUrl: string
    thumbnailUrl?: string
    emissive?: boolean
    // Visual effects (engine plume, RCS puffs, etc.)
    effects?: { [key: string]: string }
  }
}
```

## Consumer-Specific Loaders

Each consumer loads only what it needs from the definition file. This is the boundary that keeps `sim/` free of rendering concerns.

```typescript
// sim/orbital/bodyLoader.ts
function loadBodyPhysics(def: BodyDef): CelestialBody {
  // Uses: def.physics, def.atmosphere, def.terrain (generator key + params)
  // Ignores: def.render
}

// sim/vehicle/partLoader.ts
function loadPartPhysics(def: PartDef): PartPhysicsData {
  // Uses: def.physics, def.attach
  // Ignores: def.render
}

// render/bodyLoader.ts
function loadBodyVisuals(def: BodyDef): BodyVisualData {
  // Uses: def.render, def.physics.radius, def.physics.rotationRate
  // Also: def.terrain (generator key for visual terrain LOD)
  // Ignores: def.physics.mass, def.atmosphere.surfaceDensity, etc.
}

// render/partLoader.ts
function loadPartVisuals(def: PartDef): PartVisualData {
  // Uses: def.render, def.attach (for mesh placement)
  // Ignores: def.physics
}
```

## Shared Properties

Some properties are needed by both physics and rendering:

| Property | Physics use | Rendering use |
|---|---|---|
| `radius` | Collision, SOI, atmosphere altitude | Sphere size, horizon |
| `axialTilt` | Latitude-dependent atmosphere, surface-relative coords | Visual tilt of body |
| `angularVelocity` | Surface-relative velocity | Visual rotation speed |
| `terrain.generator` + params | Heightmap for environment patches | Visual terrain mesh LOD |
| `attach.points` | Structural tree, force propagation | Mesh placement, snap points in editor |

These live in whichever section is most natural (radius in physics, terrain in terrain) and both loaders read them. This is simpler than duplicating values or creating a "shared" section.

## Terrain Generator: The Shared Concern

The terrain generator is the most important shared piece. Both the orbital worker and the renderer need to produce identical terrain at the same coordinates.

**Implementation:** generators live in `sim/terrain.ts` as shared foundation code (alongside `curves.ts` and `coordinates.ts`). Both the orbital worker and the renderer import from this shared module. No boundary violation — `sim/terrain.ts` is pure math with no dependencies on `sim/orbital/` or `sim/vehicle/`.

**Near-surface:** the renderer uses the heightmap from the environment patch (the exact data physics is using). Zero divergence.

**Far-surface:** the renderer calls the terrain generator directly for LOD mesh generation (approach from orbit, horizon rendering). Same function, same seed, same result.

```
Worker calls:    terrainGenerator("rocky-wet", seed, lat, lon, res) → heights
Renderer calls:  terrainGenerator("rocky-wet", seed, lat, lon, res) → same heights
```
