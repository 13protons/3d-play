# Environment Patches

Status: **Decided**

## Core Insight

The same pattern as trajectory curves, applied to environmental data. The authoritative sim computes a complex field (atmosphere, terrain, gravity), then samples it into a simple local approximation that the consumer evaluates without understanding the underlying model.

**The vehicle worker doesn't know what an atmosphere is.** It receives a patch of local data and evaluates cheap functions — dot products, bilinear interpolation. The atmospheric model can be arbitrarily complex (tabulated, procedural, latitude-dependent, time-varying) without touching vehicle physics.

## EnvironmentPatch Type

```typescript
interface EnvironmentPatch {
  // Where and when this patch is valid
  center: SectorPosition                // absolute position (same frame as vehicle positions)
  radius: number                        // validity radius in meters
  bodyId: string                        // which body this is near (informational)
  t0: number                            // sim-time start
  t1: number                            // sim-time end

  // Atmospheric field (linear approximation — 4 numbers give you density anywhere nearby)
  atmosphere?: {
    density: number                                    // kg/m³ at center
    densityGradient: [number, number, number]           // d(density)/d(position)
    temperature: number                                // K at center
    temperatureGradient: [number, number, number]
    pressure: number                                   // Pa at center
    windVelocity: [number, number, number]             // m/s at center
  }

  // Terrain field (heightmap grid, only sent near surfaces)
  terrain?: {
    gridOrigin: [number, number]      // surface-tangent-plane origin (east, north)
    gridSize: number                  // meters per cell
    gridResolution: number            // cells per side (e.g., 32 = 32×32 grid)
    heights: Float32Array             // gridResolution² height values
    normals?: Float32Array            // per-cell surface normals (for slope)
  }

  // Gravity field (so vehicle workers don't even need to know about celestial bodies)
  gravity?: {
    acceleration: [number, number, number]             // m/s² at center
    tidal: [number, number, number,                    // 3×3 tidal gradient tensor
            number, number, number,                    // how gravity changes across
            number, number, number]                    // the vehicle's extent
  }
}
```

## Evaluation in the Vehicle Worker

The vehicle worker evaluates the patch with trivial math:

```typescript
// Atmosphere at an offset from patch center
// offset = relativePosition(patch.center, vehiclePosition) — small float64 vector
function densityAt(patch: EnvironmentPatch, offset: [number, number, number]): number {
  const a = patch.atmosphere!
  return a.density + a.densityGradient[0] * offset[0]
                   + a.densityGradient[1] * offset[1]
                   + a.densityGradient[2] * offset[2]
}

// Terrain height at a surface-plane coordinate
function terrainHeightAt(patch: EnvironmentPatch, east: number, north: number): number {
  // bilinear interpolation into patch.terrain.heights
}

// Gravity at an offset from patch center
function gravityAt(patch: EnvironmentPatch, offset: [number, number, number]): [number, number, number] {
  const g = patch.gravity!
  return [
    g.acceleration[0] + g.tidal[0]*offset[0] + g.tidal[1]*offset[1] + g.tidal[2]*offset[2],
    g.acceleration[1] + g.tidal[3]*offset[0] + g.tidal[4]*offset[1] + g.tidal[5]*offset[2],
    g.acceleration[2] + g.tidal[6]*offset[0] + g.tidal[7]*offset[1] + g.tidal[8]*offset[2],
  ]
}
```

No atmospheric model, no terrain generator, no knowledge of which celestial bodies exist. Just arithmetic on numbers in the patch.

## Refresh Triggers

The orbital worker proactively sends new patches — no request/response needed. It knows where vehicles are because vehicle workers post position updates that the bridge relays to the orbital worker (see [08-state-management.md](08-state-management.md)).

**Atmosphere patches refresh when:**
- Vehicle has moved > 50% of patch radius from center
- Validity time expired
- Vehicle crossed a significant altitude threshold
- Body's atmosphere model changed (e.g., solar heating cycle)

**Terrain patches are sent when:**
- Vehicle is below terrain-relevant altitude (< ~50km)
- Vehicle's ground track has moved > 50% off the current grid
- Vehicle is descending (proactively, before terrain is needed)

**Terrain patches are NOT sent when:**
- Vehicle is in stable orbit (no surface collision relevant)
- Vehicle is in deep space

## Data Volume

```
Atmosphere patch:  ~10 numbers = 80 bytes. Trivial.
Gravity patch:     ~12 numbers = 96 bytes. Trivial.
Terrain 32×32:     1024 floats = 4 KB. Infrequent.
Terrain 64×64:     4096 floats = 16 KB. Infrequent.

Total per update: ~4-16 KB, sent every few seconds at most.
```

## Why This Matters

1. **Decoupling.** The atmospheric model, terrain generator, and gravity solver can be arbitrarily complex and upgraded independently. Vehicle physics never touches any of it.

2. **Testability.** Vehicle physics tests use hand-crafted patches. No need to instantiate a full planetary atmosphere to test drag calculations.

3. **Fidelity scaling.** The player vehicle gets high-resolution patches (small radius, frequent refresh, 64×64 terrain). NPC vehicles get coarser patches (larger radius, less frequent, 16×16 terrain or no terrain at all). Same vehicle physics code, different input quality.

4. **Future-proof.** Adding weather, volcanic eruptions, ocean currents, magnetic fields — it's all just new fields on EnvironmentPatch. Vehicle workers that don't use those fields ignore them.
