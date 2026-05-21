# Near-Surface Terrain Strategy

## Goal

Build toward planetary terrain that works from orbit to touchdown without making the rendered mesh the source of truth for physics.

## Future State

The terrain system should be a layered tile pyramid:

- A global planetary terrain layer uses spherical quadtree tiles for broad, continuous orbit-to-ground terrain.
- Height, color, normal, biome, and material data share compatible tile footprints even when loaded at different resolutions.
- A local detail layer loads higher-fidelity spatial tiles near the camera or vehicle for rocks, cliffs, buildings, landing pads, and authored meshes.
- Physics, altitude readouts, and rendering query a shared surface provider rather than deriving truth from visible polygons.

This mirrors the useful parts of Google Earth/Cesium-style systems: hierarchical tiles, geometric error, view-dependent LOD, and separate render/query consumers over common terrain data.

## Layering Model

```text
reference body radius
+ global spherical heightfield terrain
+ local detail mesh/feature tiles
= final surface query
```

The global layer should be robust for procedural planets and orbital views. The local layer should behave like a 3D Tiles-style overlay that activates close to the ground. These are complementary; local detail refines the base terrain rather than replacing it.

## First Slice

The first slice keeps terrain height at zero, so each body is still physically a perfect sphere. It adds the seams we need:

- A deterministic terrain sampling API that returns surface height, radius, and normal for a body-local direction.
- A near-surface LOD rule that increases sphere mesh resolution enough that a landed craft visually contacts the surface more convincingly.
- A landed daylight start in the default simple scenario so near-surface visuals are easy to inspect.

This avoids fake terrain or contact hacks while moving the architecture toward shared terrain data.

## Deferred

- Real procedural heightmaps.
- Tile streaming and cache eviction.
- Local detail mesh overlays.
- Terrain-aware collision beyond zero-height sphere sampling.
- Texture/normal/material tile pyramids.
