# Orbital Mechanics

N-body integration, gravitational acceleration, atmosphere models, and environment patch generation.

Runs in the orbital worker. Owns all celestial body state. Sends trajectory curves to the renderer and environment patches to vehicle workers.

See [notes/05-physics-workers.md](../../../notes/05-physics-workers.md) for the worker architecture and output protocol.

## Files

- `worker.ts` — Worker entry point, message handling, tick loop
- `integrator.ts` — N-body integration (start with Euler, upgrade to Verlet/RK4)
- `gravity.ts` — Gravitational acceleration calculation
- `atmosphere.ts` — Atmospheric density/temperature models per body
