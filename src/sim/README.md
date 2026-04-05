# Simulation Code

Pure TypeScript. **No React or Three.js imports — ever.**

This is the most important architectural boundary in the project. Everything in `sim/` must be:
- Runnable in a Web Worker (no DOM, no WebGL)
- Unit-testable without mocking React or Three.js
- Portable to Node.js for future server-side simulation

## Structure

```
sim/
├── orbital/          Orbital mechanics (n-body integration, atmosphere, gravity)
├── vehicle/          Vehicle physics (per-part: fuel, drag, thrust, thermal)
├── types.ts          Shared types (SectorPosition, Command, TrajectoryCurve, etc.)
├── coordinates.ts    SectorPosition math (normalize, relativePosition, toRenderFrame)
├── curves.ts         Cubic Hermite spline evaluation
├── terrain.ts        Terrain generators (shared by orbital worker + renderer)
└── constants.ts      Physical constants (G, AU, etc.)
```

## Key Rules

1. `orbital/` and `vehicle/` do not import each other. They share types via `types.ts`.
2. The orbital domain doesn't know vehicles exist.
3. The vehicle domain doesn't know how atmosphere/terrain is generated — it evaluates `EnvironmentPatch` data.
4. Foundation modules (`types.ts`, `coordinates.ts`, `curves.ts`, `terrain.ts`, `constants.ts`) are importable by anyone, including the renderer.
