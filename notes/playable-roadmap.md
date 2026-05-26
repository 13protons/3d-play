# Playable Roadmap

Status: **Draft**

Goal: turn the current flight loop into a playable mission-planning game. Two parallel tracks — **mission planning** (map view + maneuver nodes) and **attitude control** (hold modes + handling) — converge on the same gameplay: pick a target, plan a burn, hold the orientation, execute it.

Out of scope for this milestone: parts/editor, NPC worker, environment patches, save/load, SOI collapse, advanced atmosphere. See [00-overview.md](00-overview.md) for the broader architecture.

---

## Epic 1 — Orbit View Interaction

The existing orbital scene (`src/render/Scene.tsx`) already renders bodies, full orbit lines, vehicle markers, and predicted trajectories with a pan/zoom camera. It IS the map — the separate-canvas plan in [09-game-modes.md](09-game-modes.md) is deferred. Instead, augment what's there with the interaction primitives Epic 2 needs.

- [x] `M` key toggle binding (`src/modes/Flight.tsx:119`)
- [x] Map ↔ flight focus sync (single `useCameraStore.followTargetId`, both views subscribe)
- [ ] Body labels (HTML overlay or sprites) with size-based culling
- [ ] 3D body picking — click a body in the scene to set focus/target (HUD list already has this; the 3D scene doesn't)
- [ ] Input context push/pop per [09-game-modes.md](09-game-modes.md) — defer until Epic 2 introduces a real conflict (click-to-place vs vehicle controls)

Deferred (revisit if performance/structure demands it):
- Second `<Canvas>` + `useFrame` freeze gating
- Keplerian conic display fallback (current sampled-trajectory rendering is fine)

## Epic 2 — Maneuver Nodes

Plan-then-execute burns. Node lives in state, drives both orbit-view preview and autopilot hold. This is where mission planning actually starts to feel like a game.

**Data**

- [ ] `ManeuverNode` type: `{ simTime, deltaV: [prograde, normal, radial], vesselId }`
- [ ] Maneuver store (Zustand) — list of pending nodes per vessel

**Placement & editing in the orbit view**

- [ ] Click on vehicle prediction line → create node at that anomaly (ray-pick onto the existing sampled trajectory)
- [ ] Drag handles on node: prograde/retrograde, normal/antinormal, radial-in/out
- [ ] Post-burn trajectory preview — integrate (or patched-conic-approximate) forward from node, render on the same canvas as a distinct line
- [ ] Node deletion / editing

**HUD & execution**

- [ ] Time-to-node readout on HUD
- [ ] Burn-time estimate from current TWR; "burn start" / "burn end" markers
- [ ] Auto-warp-to-node (warp until ~burn start, then drop warp)
- [ ] Node execute handoff — autopilot consumes the node's deltaV-frame vector, seeks attitude, throttles for the burn window

## Epic 3 — Attitude Hold Modes (Autopilot v0.1)

Reframe: attitude hold isn't a vehicle-worker state, it's the **first autopilot**. The autopilot publishes a "seek this direction" hint on the message bus; the vehicle's attitude control layer just tracks whatever vector it's told. Every future autopilot — maneuver-node execution, ascent guidance, landing, target rendezvous — uses the same `set-attitude-target` channel. The mode menu (prograde/retrograde/normal/…) lives in the autopilot, not the worker.

Pitch/yaw seek only — no roll seek. Roll is always damp-only (already true in `forwardDirectionHoldTorque`). Reference-frame switching reuses `computeFlightReferenceFrame` (the same regime switch the navball and orbit prediction already use — pilot sees one consistent frame everywhere).

**Architecture work**

- [x] Split `VehicleAttitudeMode` into two concerns:
  - Vehicle control state: `'manual' | 'damp' | 'seek-forward'` (later: `'seek-orientation'`)
  - Autopilot mode: `'off' | 'prograde' | 'retrograde' | 'normal' | 'antinormal' | 'radial-in' | 'radial-out'` (later: `target`, `maneuver`)
- [x] New worker message: `{ type: 'set-attitude-target', kind: 'forward' | 'damp' | 'manual', vector?: Vec3, simTime }`
- [x] Vehicle worker stops owning autopilot mode — only owns the seek primitive
- [x] Autopilot module: pure function `(autopilotMode, vehicleState, trajectoryFrame) → AttitudeTarget`
- [x] Decide placement (see below) and wire it into the per-tick loop (bridge dispatches per-tick)

**Autopilot modes (each ~10 lines once infra is done)**

- [x] Prograde / Retrograde (uses `navVelocity` from `computeFlightReferenceFrame` — auto-switches orbital ↔ surface like the navball)
- [x] Normal / Antinormal (orbit-plane normal, always orbital frame — degenerates near-radial; fall back to `damp`)
- [x] Radial-in / Radial-out (already-computed `radialOut` from the reference frame)

**UI & navball**

- [x] Hold-mode button cluster on HUD (autopilot mode buttons, manual cancels)
- [x] Navball markers for prograde, retrograde, normal, antinormal, radial-in, radial-out
- [x] Active autopilot mode indicator on HUD
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

1. ~~Epic 3 (hold modes)~~ — done.
2. Epic 1 (orbit view interaction) — small, unblocks Epic 2.
3. Epic 2 (maneuver nodes) — the main gameplay loop.
4. Epic 4 (control quality) — easier to tune once you can place a node and watch the craft fail to hit it.
5. Epic 5 — incremental throughout.
