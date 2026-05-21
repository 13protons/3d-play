# Layered Terrain Render Passes

## Goal

Remove near-surface terrain seams by rendering detailed terrain as an overlay pass over the global body sphere, instead of hiding and showing mutually exclusive meshes.

## Problem

The current local surface patch is a single flat mesh that temporarily hides the parent body sphere. When the camera zooms out, the patch edge can expose black space before the renderer switches back to the global sphere. Threshold bands reduce the symptom but do not solve the underlying issue: the renderer treats local terrain and the body sphere as exclusive modes.

## Design

Use Three.js `Layers` as render-pass masks:

```text
BASE_BODY_LAYER
  stars, sun, low-res/high-level body sphere

TERRAIN_OVERLAY_LAYER
  near/regional terrain chunks around the camera or vehicle

VEHICLE_LAYER
  craft, thrust plume, debug axes, future vehicle-local effects
```

Render order:

```text
1. clear color + depth
2. render BASE_BODY_LAYER
3. clear depth only
4. render TERRAIN_OVERLAY_LAYER
5. render VEHICLE_LAYER
```

This keeps the base sphere visible everywhere while allowing terrain overlays to draw over it without z-fighting or clipping against the base sphere depth buffer. The terrain overlay remains real 3D geometry in scene space; layers only control which render pass sees it.

## First Slice

Replace the current flat local patch with a curved regional terrain overlay rendered in `TERRAIN_OVERLAY_LAYER`.

Initial constraints:

- Keep terrain height at zero for now.
- Generate overlay vertices on the parent body's sphere, centered around the vehicle/camera radial direction.
- Add a small visual radial bias so the overlay sits above the base sphere.
- Keep the parent body sphere always visible; remove body-hiding rules for local surface rendering.
- Keep physics and altitude queries tied to `sampleSphericalTerrain()`, not the rendered overlay mesh.

## Depth Behavior

The key operation is clearing depth after the base pass:

```ts
renderer.render(scene, cameraWithBaseLayer)
renderer.clearDepth()
renderer.render(scene, cameraWithTerrainLayer)
renderer.render(scene, cameraWithVehicleLayer)
```

The terrain pass does not need to fight the body sphere depth. The vehicle pass should generally render after terrain without clearing depth so terrain can later occlude landed or partially hidden vehicle geometry correctly.

## Why Not Separate Scenes First

A separate scene could work later, but it adds synchronization and lighting complexity. Three.js layers provide the needed pass filtering while keeping one scene graph, one camera, and existing React Three Fiber object ownership.

## Deferred

- Camera-driven terrain tile selection using screen-space error.
- Multiple overlay chunks with skirts or overlapping edges.
- Heightfield sampling beyond zero-height sphere.
- Alpha fading or material blending at overlay boundaries.
- Dedicated render composer or postprocessing pipeline.
