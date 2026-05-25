# Render Performance Follow-Ups

This list captures the performance and architecture review after the shared planet surface rendering work in `f773b84 align planet surface rendering modes`.

Work through the high-priority items first. The remaining items are still important, but should follow after the major render-mode, terrain, and prediction bottlenecks are under control.

## High Priority

1. Centralize surface render decisions for orbital and vehicle modes.

   Current risk: `VehicleBody`, `Body`, and `PlanetTerrainTiles` still make related visibility decisions in separate places. That can reintroduce gaps or contention between fallback body surfaces and terrain tiles.

   Target: one shared surface render decision object should determine, for a body and camera state, whether the active mode is `sprite`, `fallback-surface`, or `tiles`. Both the fallback body renderer and terrain renderer should consume the same decision.

2. Reduce full-shell terrain draw-call cost.

   Current risk: tiled mode renders a complete LOD4 cube-sphere shell: `6 * 16 * 16 = 1536` tile meshes per tiled body. That creates many React components, geometries, materials, draw calls, and potential frame callbacks.

   Target: either merge the coarse full-shell geometry per body/material, or render only camera-relevant tiles with parent fallback. Establish a hard draw-call/tile budget before adding higher LOD detail.

3. Remove per-frame full-shell tile selection work.

   Current risk: `PlanetTerrainTiles` can rebuild tile ID arrays and large string keys every frame even when the selected shell is unchanged.

   Target: memoize full-shell tile IDs by `{ bodyId, lod }`, compare compact selection versions instead of joined string keys, and only update selection when camera/body LOD inputs cross thresholds.

4. Cache and right-size fallback body surface geometry.

   Current risk: fallback surfaces now use shared cube-sphere geometry for orientation correctness, but the geometry is eagerly generated per body/view and uses a full LOD4 shell.

   Target: cache fallback geometries by body/radius and use a coarser shared fallback surface where acceptable. Keep the same cube-sphere/UV convention, but avoid rebuilding heavy geometry unnecessarily.

5. Fix vehicle orbit prediction recomputation triggers.

   Current risk: vehicle prediction can recompute every frame during normal coasting flight if inertial velocity deltas are interpreted as acceleration. Gravity alone changes inertial velocity frame-to-frame.

   Target: drive recompute urgency from controls/throttle/aero/actual non-gravity inputs or a physics-aware delta. Avoid `predictVehicleOrbit()` and `setPrediction()` unless inputs materially changed.

6. Preserve render-data pipeline boundaries for terrain.

   Current risk: `PlanetTerrainTiles` directly reads Zustand stores and evaluates simulation curves. That keeps the message bus intact, but couples terrain rendering to app state and simulation curve shape.

   Target: move store/curve reads into `Scene`/`VehicleScene` adapters or dedicated render-data selectors. Keep `PlanetTerrainTiles` closer to a pure renderer of prepared placement, visibility, and tile-selection inputs.

## Medium Priority

1. Share terrain materials per body/render mode.

   Current risk: each terrain tile uses `BodyMaterial`, producing many material instances. Textures are likely cached, but material instances still add memory and renderer bookkeeping.

   Target: create one shared material per body/surface mode, or merge tiles that share a material.

2. Remove per-tile `useFrame` callbacks.

   Current risk: each `TerrainTileMesh` registers a frame callback just to set layers. At full-shell scale this creates a large number of frame callbacks.

   Target: set layers with an effect, JSX/parent layer configuration, or a parent traversal only when `renderLayer` changes.

3. Add explicit GPU geometry lifecycle management.

   Current risk: custom `BufferGeometry` instances rely mostly on React Three Fiber implicit disposal. Dynamic LOD, remounts, or body changes can make lifecycle less obvious.

   Target: add explicit `geometry.dispose()` cleanup for memoized/custom geometries where ownership is clear, or standardize on declarative geometry ownership.

4. Add tile cache eviction, cancellation, and rejection cleanup.

   Current risk: `TerrainTileCache` retains loaded tiles indefinitely, does not clear failed in-flight requests in `finally`, and async loads can update state after unmount.

   Target: add LRU/size bounds, clear loading entries on rejection, and use an alive/request token to ignore stale async completions.

5. Clip orbit predictions for outside-to-outside body crossings.

   Current risk: `splitOrbitLineSegments()` handles inside/outside crossings, but sparse outside-to-outside segments whose chord crosses through the exclusion sphere may not be clipped.

   Target: add a regression test for outside-to-outside sphere crossings and split/drop the interior chord while preserving the visible orbit line near the body boundary.

6. Invalidate prediction caches on time rewind and curve/body replacement.

   Current risk: prediction recompute checks only consider elapsed simulated time. If sim time resets/rewinds or curves are replaced at similar times, stale geometry can persist.

   Target: recompute when time moves backwards and when relevant curve/body/control identities change.

## Lower Priority / Follow-On Work

1. Avoid small tuple allocations in tile generation hot loops.

   Current risk: generated tile code allocates tuple arrays per vertex. This is fine at current scale, but will become expensive at higher LOD or worker streaming rates.

   Target: use numeric locals and write directly into output arrays.

2. Bound orbit prediction segment counts.

   Current risk: clipping creates one `<Line>` per visible segment. Usually this is only one or two, but pathological cases can increase render objects.

   Target: keep segment counts bounded/tested or move to a single buffer geometry with breaks if needed.

3. Decide whether to keep or remove unused focus tile selection paths.

   Current risk: `selectTerrainTiles()` and focus direction plumbing exist, but current rendering uses a full shell. This can confuse the intended pipeline.

   Target: either wire focused tile selection into a clear LOD policy with parent fallback, or remove/defer unused paths until the renderer is ready for them.

4. Plan worker-backed terrain streaming only after topology and fallback are stable.

   Current risk: adding workers before render-mode, cache, and fallback policies are solid will make debugging harder.

   Target: stabilize the render-data boundary, central decision object, cache lifecycle, and parent/child fallback before adding worker streaming.

## Review Notes

- The core simulation/message-bus architecture is still intact. No direct worker or message-bus changes were introduced in the reviewed range.
- The main architectural drift is render-side: terrain currently does store reads and curve evaluation internally.
- The highest-leverage next step is a shared surface render decision object, followed by reducing full-shell draw calls and per-frame work.
