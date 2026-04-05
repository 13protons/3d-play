# Game Modes

Status: **Decided**

## Two Axes: Sim State + View State

Game state has two independent axes, not one flat mode list.

**Sim state** — is the physics running?
- **Active** (flight) — workers ticking, trajectory curves flowing
- **Idle** (menu, editor) — workers not started or paused

**View state** — what is the player looking at?
- **Flight view** — floating origin, vessel chase cam, HUD
- **Map overlay** — orbital paths, maneuver nodes, system-scale camera
- **Editor** — part assembly (future, idle sim)
- **Menu** — settings, save/load (no canvas)

## Modes

### Menu
No simulation, no 3D canvas. Title screen, settings, save/load.

### Flight
Sim is running. This is the primary gameplay mode. Contains two sub-views:

- **Flight view** — 3D scene with floating origin, vessel rendering, HUD overlay
- **Map view** — orbital map for trajectory planning, maneuver nodes, system-scale view

Map is togglable during flight. **The sim keeps running when the map is open** — time passes at whatever warp rate is active. You plan maneuvers in a live universe, matching KSP behavior.

### Editor (future)
No simulation running. Part assembly screen. Deferred — not in first milestone.

## Canvas Management

**Each view has its own `<Canvas>`.** Flight view and map view are separate R3F canvases.

**Both canvases stay mounted.** No creation/destruction on toggle. WebGL context teardown is expensive and causes visual flashes. Instead:

- The **active** canvas runs its `useFrame` loop normally — evaluates trajectory curves, updates positions, renders.
- The **inactive** canvas is **frozen** — its `useFrame` callbacks are gated by a boolean and don't fire. Zero render cost. The canvas DOM element can be hidden via CSS (`visibility: hidden` or `display: none`).
- When reactivated, the canvas picks up immediately with current trajectory curve data. No stale frames.

This means switching between flight view and map view is instant — no loading, no context rebuild, just show/hide and flip the `useFrame` gate.

**Open question for later:** when both views are visible simultaneously (picture-in-picture? split screen?), both canvases run their `useFrame` loops. This doubles render cost but both views are small enough for it to be fine.

## Input Context Stack

Different views need different input bindings. The same keys do different things in different contexts. **A pause menu must suppress vehicle commands.**

Input is managed as a **stack of contexts**. The top of the stack receives keyboard/mouse input. A "blocking" context prevents all lower contexts from receiving input.

```typescript
interface InputContext {
  id: string
  bindings: Map<string, () => void>
  blocking: boolean   // if true, contexts below are suppressed
}

// The input system maintains a stack:
// Top of stack = active context
```

### Context Stack Examples

```
Flight only:          [flight]
                      → WASD = attitude, shift/ctrl = throttle

Flight + map open:    [flight, map]
                      → map gets keyboard (pan, zoom, select)
                      → flight bindings suppressed

Flight + pause menu:  [flight, menu(blocking)]
                      → menu gets keyboard (navigate, select)
                      → everything below blocked
                      → no vehicle commands can fire

Map + pause menu:     [flight, map, menu(blocking)]
                      → menu gets keyboard
                      → map and flight both blocked
```

### How It Works

- Each view **pushes** its context onto the stack when it gains focus.
- Each view **pops** its context when it loses focus or unmounts.
- The input system reads from the top of the stack. If the top context doesn't handle a key, and it's not blocking, the key falls through to the next context.
- Commands produced by the active context are pushed into the command buffer (for sim-affecting inputs) or handled directly (for camera/UI inputs).

This prevents the "accidentally fire thrusters from the pause menu" problem structurally. When a blocking context is on the stack, nothing below it can produce commands.

## Mode Transitions

```
menu → flight:       Start workers, mount flight + map canvases, push flight input context
flight → menu:       Pause workers, push blocking menu context (canvases stay mounted but frozen)
flight ↔ map:        Toggle which canvas is active/frozen, swap input context on stack
flight → editor:     (future) Pause workers, unmount flight canvases, mount editor canvas
editor → flight:     (future) Serialize vessel → start workers with vessel data, mount flight canvases
```

### State Preservation

- **Menu over flight:** sim pauses (or continues based on user preference). Flight state preserved. Closing menu resumes exactly where you were.
- **Map toggle:** sim keeps running. Both views read from the same trajectory curve store. No state to transfer — they're both live views of the same sim.
- **Editor → flight (future):** this is the big transition. The vessel built in the editor must be serialized into `VesselPhysics` data for the vehicle worker. This serialization is the bridge between creative tool and physics object.
