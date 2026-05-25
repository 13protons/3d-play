# Playable Roadmap

Status: **Draft**

Goal: turn the current flight loop into a playable mission-planning game. Two parallel tracks — **mission planning** (map view + maneuver nodes) and **attitude control** (hold modes + handling) — converge on the same gameplay: pick a target, plan a burn, hold the orientation, execute it.

Out of scope for this milestone: parts/editor, NPC worker, environment patches, save/load, SOI collapse, advanced atmosphere. See [00-overview.md](00-overview.md) for the broader architecture.

---

## Epic 1 — Map View

Dual-canvas map overlay per [09-game-modes.md](09-game-modes.md). Sim keeps running underneath.

- [ ] Mount second `<Canvas>` for map view; flight canvas stays mounted
- [ ] `useFrame` gating so the inactive canvas is frozen (zero cost)
- [ ] System-scale camera: pan / zoom / focus-on-body
- [ ] Render full orbit paths from trajectory curves (closed-orbit approximation from current `p, v` — Keplerian conic for display only, not physics)
- [ ] Render vehicle predicted trajectory (extends existing `VehicleOrbitPrediction`)
- [ ] Toggle binding (`M` key) with input-context push/pop
- [ ] Body labels + selection highlight in map view
- [ ] Map ↔ flight focus target sync

## Epic 2 — Maneuver Nodes

Plan-then-execute burns. Node lives in input/state stores, drives both map preview and autopilot hold.

- [ ] `ManeuverNode` type: `{ simTime, deltaV: [prograde, normal, radial], vesselId }`
- [ ] Maneuver store (Zustand) — list of pending nodes per vessel
- [ ] Map-view node placement: click on orbit → creates node at that anomaly
- [ ] Drag handles on node: prograde/retrograde, normal/antinormal, radial-in/out
- [ ] Post-burn trajectory preview: integrate (or patched-conic-approximate) forward from node, render on map
- [ ] Time-to-node readout on HUD
- [ ] Auto-warp-to-node (warp until burn start, then drop warp)
- [ ] Node "execute" handoff: feeds desired attitude vector to autopilot (Epic 3)
- [ ] Burn-time estimate from current TWR; render "burn start" / "burn end" markers
- [ ] Node deletion / editing

## Epic 3 — Attitude Hold Modes (Autopilot v0.1)

Reframe: attitude hold isn't a vehicle-worker state, it's the **first autopilot**. The autopilot publishes a "seek this direction" hint on the message bus; the vehicle's attitude control layer just tracks whatever vector it's told. Every future autopilot — maneuver-node execution, ascent guidance, landing, target rendezvous — uses the same `set-attitude-target` channel. The mode menu (prograde/retrograde/normal/…) lives in the autopilot, not the worker.

Pitch/yaw seek only — no roll seek. Roll is always damp-only (already true in `forwardDirectionHoldTorque`). Reference-frame switching reuses `computeFlightReferenceFrame` (the same regime switch the navball and orbit prediction already use — pilot sees one consistent frame everywhere).

**Architecture work**

- [ ] Split `VehicleAttitudeMode` into two concerns:
  - Vehicle control state: `'manual' | 'damp' | 'seek-forward'` (later: `'seek-orientation'`)
  - Autopilot mode: `'off' | 'prograde' | 'retrograde' | 'normal' | 'antinormal' | 'radial-in' | 'radial-out'` (later: `target`, `maneuver`)
- [ ] New worker message: `{ type: 'set-attitude-target', kind: 'forward' | 'damp' | 'manual', vector?: Vec3, simTime }`
- [ ] Vehicle worker stops owning autopilot mode — only owns the seek primitive
- [ ] Autopilot module: pure function `(autopilotMode, vehicleState, trajectoryFrame) → AttitudeTarget`
- [ ] Decide placement (see below) and wire it into the per-tick loop

**Autopilot modes (each ~10 lines once infra is done)**

- [ ] Prograde / Retrograde (uses `navVelocity` from `computeFlightReferenceFrame` — auto-switches orbital ↔ surface like the navball)
- [ ] Normal / Antinormal (orbit-plane normal, always orbital frame — degenerates near-radial; fall back to `damp`)
- [ ] Radial-in / Radial-out (already-computed `radialOut` from the reference frame)

**UI & navball**

- [ ] Hold-mode button cluster on HUD (autopilot mode buttons, manual cancels)
- [ ] Navball markers for prograde, retrograde, normal, antinormal, radial-in, radial-out
- [ ] Active autopilot mode indicator on HUD
- [ ] Mode persists across warp; verify `shouldStabilizeAngularVelocityForWarp` still gates correctly

**Deferred to later epics**

- Target / antitarget (needs target-selection system — Epic 2 or later)
- Maneuver hold (needs `ManeuverNode` from Epic 2)

## Epic 4 — Attitude Control Quality

Make the autopilot feel good. Current PD-style reaction-wheel torque tends to overshoot at high inertia or oscillate near target.

- [ ] Tune / generalize gains by moment-of-inertia and reaction-wheel torque
- [ ] Critical damping behavior on approach (no overshoot, no lazy creep)
- [ ] Angular-rate clamp so high-torque craft don't slam into target
- [ ] Manual-input blending: when user nudges during a hold, transient override then resume
- [ ] SAS on/off (kill rotation entirely vs. autopilot off)
- [ ] Per-axis trim
- [ ] Diagnostics: visualize commanded vs. actual torque on HUD/debug overlay

## Epic 5 — Glue & Polish

- [ ] Input-context stack actually implemented (currently flat handlers)
- [ ] Replace placeholder README with project README
- [ ] Persist last-selected scenario / camera target
- [ ] Map-view performance pass (orbit lines for 12+ bodies)

---

## Suggested order

1. Epic 3 first (hold modes) — unlocks the autopilot interface that Epic 2 will hand off to. Self-contained and shippable.
2. Epic 1 (map view) — needed before maneuver nodes can be placed.
3. Epic 2 (maneuver nodes) — depends on 1 and 3.
4. Epic 4 (control quality) — easier to tune once you can place a node and watch the craft fail to hit it.
5. Epic 5 — incremental throughout.
