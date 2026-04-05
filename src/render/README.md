# Rendering

React Three Fiber components. Consumes Zustand stores and evaluates trajectory curves — does **not** import physics code from `sim/orbital/` or `sim/vehicle/`.

Allowed `sim/` imports: `types.ts`, `curves.ts` (Hermite evaluator), `terrain.ts` (deterministic terrain generators for visual LOD), `coordinates.ts`.

## Files

- `Scene.tsx` — Top-level R3F Canvas, floating-origin logic
- `Body.tsx` — Celestial body rendering (sphere + atmosphere + effects)
- `Vessel.tsx` — Vessel rendering (assembled part meshes)
- `OrbitLine.tsx` — Projected orbit path visualization
- `CameraRig.tsx` — Camera controllers per game mode
- `SkyBox.tsx` — Background star field
