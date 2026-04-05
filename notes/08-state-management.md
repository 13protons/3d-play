# State Management

Status: **Decided**

## Zustand

Chosen because:
- Works well outside React's render cycle — the bridge can write to stores directly via `getState().setState()` without triggering React renders on the bridge side
- Simple API that doesn't fight you as state grows
- Widely used with R3F — well-tested patterns exist
- No boilerplate (vs. Redux) and no magic (vs. MobX)

## Store Layout

| Store | Writes from | Reads from | Purpose |
|-------|------------|------------|---------|
| `trajectories` | Bridge (from all workers) | R3F render components | Hermite curves for all entities (bodies + vessels) |
| `vehicle` | Bridge (from player vehicle worker) | UI/HUD | Part-level state: fuel levels, temperatures, stress, staging |
| `camera` | Camera rig, mode transitions | R3F Scene (floating origin) | Current origin, follow target |
| `mode` | UI, game logic | App root (mode router), input system | Active game mode + view state |
| `input` | Key/mouse handlers | Bridge (drains it) | Command buffer |

## Bridge

The bridge manages all three workers, routes commands to the correct worker, relays inter-worker data (environment patches, vehicle positions), and funnels output into stores.

```typescript
// bridge.ts
const orbitalWorker = new Worker(new URL('../sim/orbital/worker.ts', import.meta.url), { type: 'module' })
const playerVehicleWorker = new Worker(new URL('../sim/vehicle/worker.ts', import.meta.url), { type: 'module' })
// const npcVehicleWorker = ... (future)

// OUTBOUND: drain command buffer → route to correct worker
function flushCommands() {
  const commands = useInputStore.getState().drain()
  for (const cmd of commands) {
    if (cmd.type === 'set-warp') {
      orbitalWorker.postMessage({ type: 'set-warp', rate: cmd.rate })
    } else {
      playerVehicleWorker.postMessage({ type: 'commands', commands: [cmd] })
    }
  }
}

// INBOUND: orbital worker → stores + vehicle workers
orbitalWorker.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'trajectories') {
    useTrajectoriesStore.getState().updateCurves(msg.curves)
  }
  if (msg.type === 'environment-patch') {
    // Relay to the appropriate vehicle worker
    playerVehicleWorker.postMessage(msg)
  }
}

// INBOUND: player vehicle worker → stores + orbital worker
playerVehicleWorker.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'trajectories') {
    useTrajectoriesStore.getState().updateCurves(msg.curves)
  }
  if (msg.type === 'vehicle-state') {
    useVehicleStore.getState().update(msg)
  }
  if (msg.type === 'position-update') {
    // Relay vehicle position to orbital worker for environment patch generation
    orbitalWorker.postMessage({ type: 'vehicle-positions', vehicles: [msg] })
  }
}
```

### Inter-Worker Communication

Web Workers can't talk to each other directly. All inter-worker messages route through the bridge on the main thread:

- **Orbital → Vehicle workers:** environment patches. Orbital worker posts to main thread, bridge relays to vehicle workers.
- **Vehicle → Orbital worker:** vehicle position updates. Vehicle worker posts position to main thread, bridge relays to orbital worker (so it knows where to generate patches).

This adds one main-thread hop per message, but these messages are infrequent (environment patches every few seconds, position updates at low frequency) so the overhead is negligible.
