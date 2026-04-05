# State Management

Zustand stores and the worker bridge. This is the glue between simulation workers and the React rendering layer.

See [notes/08-state-management.md](../../notes/08-state-management.md) for store layout and bridge design.

## Stores

- `trajectories.ts` — Trajectory curves from all workers, consumed by the renderer
- `vehicle.ts` — Part-level state (fuel, temps, stress) for HUD display
- `camera.ts` — Floating origin position, follow target, camera mode
- `mode.ts` — Game mode state machine (sim state × view state)
- `input.ts` — Command buffer (timestamped commands waiting to be dispatched)

## Bridge

- `bridge.ts` — Manages worker lifecycle, routes commands to the correct worker, relays inter-worker messages (environment patches, position updates). All worker communication flows through here.
