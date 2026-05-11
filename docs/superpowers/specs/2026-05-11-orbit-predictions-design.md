# Orbit Predictions Design

## Goal
Replace historical body trails with orbital-view-only prediction rings for celestial bodies.

## Scope
The first version renders one full Keplerian orbit prediction for each body that has a parent. It does not render vehicle predictions, encounter markers, SOI transitions, multi-orbit paths, or n-body sampled future paths.

## Behavior
- Show orbit predictions only in orbital view.
- Do not render history trails.
- Do not render body orbit predictions in vehicle view.
- Compute predictions from the current body and parent curves once both are available.
- Recompute each prediction every 10 simulated minutes.
- Per frame, only reposition the prediction group relative to the parent and camera target.
- Skip prediction rendering for degenerate, parabolic, hyperbolic, or otherwise unsampleable states.

## Accuracy
Predictions are a two-body Kepler approximation using each body's current parent-relative state. This is accurate enough for a visual next-cycle prediction of stable planetary/moon orbits, but intentionally less exact than the n-body simulation.

## Data Flow
- `OrbitPrediction` reads body metadata, parent metadata, curves, active view, and follow target from existing stores.
- It evaluates the body and parent curves at current sim time.
- It computes relative position and velocity.
- It uses parent `gm`, not `G * mass`, to produce orbital elements.
- It samples one closed loop and renders it parent-relative.

## Rendering
Prediction rings replace the old fading history traces. Orbit line color is independent from the planet mesh/sprite color so each prediction can stay legible. Lines should render at a minimum 3px width with 70% opacity.

Directionality is implied by a stable per-vertex brightness gradient: the segment behind the body is brighter and the segment ahead is darker. Sampling is denser within 10 degrees of the body's current anomaly so close-up views near the planet do not show obvious polygon artifacts.

## Deferred
- Vehicle path prediction.
- Static/fallback scenario rings.
- Encounter prediction.
- SOI transition visualization.
- N-body future sampling.
