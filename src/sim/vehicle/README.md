# Vehicle Physics

Per-part simulation for vessels: fuel flow, thrust, atmospheric drag, thermal, structural loads.

The player vehicle worker runs full-fidelity simulation. The NPC vehicle worker runs simplified models for all other vessels.

Evaluates `EnvironmentPatch` data for atmosphere, terrain, and gravity — does **not** import from `orbital/` or know how those fields are computed.

See [notes/05-physics-workers.md](../../../notes/05-physics-workers.md) for the worker architecture.

## Files

- `worker.ts` — Vehicle worker entry point, message handling, physics tick
- `parts.ts` — Per-part physics (fuel drain, temperature, stress)
- `drag.ts` — Compound drag surface and windward area calculation
- `thrust.ts` — Engine thrust vectors, gimbal, staging logic
- `environment.ts` — Evaluate EnvironmentPatch (densityAt, gravityAt, terrainHeightAt)
