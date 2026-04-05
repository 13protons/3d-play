# Input Buffering & Commands

Status: **Decided**

## Core Principle

User inputs never directly mutate simulation state. They flow through a command buffer.

## Data Flow

1. User presses a key or moves a slider → produces a **command** (e.g., `{ type: 'set-throttle', value: 0.8, simTime: 12345.6 }`)
2. Command gets pushed into an **input buffer** (a Zustand store — essentially an array)
3. On each `requestAnimationFrame`, the bridge **drains the buffer** and posts the batch to the worker via `postMessage`
4. Worker receives batch, applies commands in order at the start of its next physics step
5. Worker posts back trajectory curves and/or part state updates

## Every Command Carries a `simTime`

Non-negotiable. Costs nothing — one number per command. Essential for deterministic replay in single-player and critical for any future multiplayer sync.

## Properties

- **Determinism** — inputs are timestamped and applied at defined sim ticks, not whenever the event handler fires
- **Time warp safety** — when running 1000x, the worker runs many steps per message. Commands get queued and applied at the right sim time, not smeared across steps
- **Replay/save** — record the command stream to replay an entire flight. Save files = initial state + command log (tiny)
- **Decoupling** — main thread just says "the player wants this," the worker decides when and how to apply it

## What Gets Buffered

Anything that affects simulation state: throttle, attitude, staging, SAS toggles.

Camera movement, UI toggles, map zoom stay on the main thread — they affect rendering only.

The test: **"would replaying this command reproduce the same flight?"** If yes → buffer it.

## Command Types

Commands are split into two categories for routing. The bridge drains both from the same buffer but sends them to different workers.

```typescript
// Routed to player vehicle worker
type VehicleCommand =
  | { type: 'set-throttle'; value: number; simTime: number }
  | { type: 'set-attitude'; pitch: number; yaw: number; roll: number; simTime: number }
  | { type: 'stage'; simTime: number }

// Routed to orbital worker
type SimCommand =
  | { type: 'set-warp'; rate: number; simTime: number }

type Command = VehicleCommand | SimCommand
```

All commands go through the same buffer with `simTime`. The bridge routes by type — `SimCommand`s to the orbital worker, `VehicleCommand`s to the player vehicle worker. Everything is timestamped, everything is replayable, and routing is explicit in the type system.

## Message Protocol

See [05-physics-workers.md](05-physics-workers.md) for the full output protocol (trajectory curves, active updates, events).

**Inbound (Main → Orbital Worker):**
- `{ type: 'commands', commands: SimCommand[] }`
- `{ type: 'vehicle-positions', vehicles: [...] }` (relayed from vehicle workers)

**Inbound (Main → Vehicle Worker):**
- `{ type: 'commands', commands: VehicleCommand[] }`
- `{ type: 'environment-patch', ... }` (relayed from orbital worker)

**Outbound (Worker → Main):**
- `{ type: 'trajectories', ... }` — cubic Hermite curves with validity windows
- `{ type: 'active', ... }` — per-tick updates for fast-changing entities (transferable Float64Array)
- `{ type: 'event', ... }` — simulation events (collisions, SOI changes)

## Time Warp

Start with "apply commands at batch boundary" (before all steps in a tick). Upgrade to mid-batch timestamped insertion later when maneuver nodes need exact timing. Same message format, just smarter worker logic — no architectural change.

## Rendering Smooth Motion

The renderer evaluates **trajectory curves** (cubic Hermite splines) sent by the worker, rather than interpolating between raw position snapshots. This produces physically correct curved motion instead of straight-line interpolation. See [05-physics-workers.md](05-physics-workers.md) for details on the curve format, parent-relative framing, and validity windows.

## Multiplayer Considerations (Future)

The main↔worker boundary is the load-bearing interface regardless of single-player or multiplayer. The worker is always the client's physics authority.

In multiplayer, the worker gains a **second inbound channel** (server corrections) in addition to local commands — it doesn't replace the existing architecture. The worker would reconcile server-authoritative state with local prediction. The main thread never knows the difference.

**Time warp in multiplayer:** consensus-based. All players must agree on warp rate. No time bubbles, no per-player time advancement, no reconciliation math. This makes it the users' problem to collaborate, which is simpler to implement and more socially honest.

**What NOT to build now:** don't design the worker protocol to simulate network conditions (latency, packet loss, out-of-order delivery). The worker has ~0ms latency and perfect ordering. Server-side concerns (client prediction, rollback, clock skew) deserve their own design layer when the time comes — they'll sit between the server and the worker, not replace the worker protocol.
