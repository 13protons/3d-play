# Scene Editor Follow-Ups

Review of the scene editor (`/editor`) after the vehicle part-mesh pipeline landed. The
editor shipped in PR #10 (`c48ec75`, `2f0c244`) and is complete for its original scope:
placement authoring against a live paused preview. This list captures what it needs next.

The ordering matters. Item 1 is a live data-loss bug; everything else assumes it is
fixed.

## High Priority

1. Carry `parts` / `partDefs` through the draft model.

   Current risk: **authoring a multi-part craft silently destroys it.**
   `two-stage-ascent.json`'s vehicle carries `parts` and `partDefs`, and
   `appRoutes.ts:21` offers Two-Stage Ascent as an editor base scenario. But
   `SceneVehicle` (`src/data/sceneDraft.ts:63-74`) has no field for either,
   `buildDraftFromScenario` does not read them (`sceneDraft.ts:222-285`), and
   `resolveScene` does not re-emit them (`sceneDraft.ts:372-383`). Creating a scene
   from that base collapses the staged rocket into a `mesh`-only craft, and
   `/play/:sceneId` launches the collapsed version. This contradicts the module's own
   contract — "the draft is the source of truth on disk so a scene reopens losslessly"
   (`sceneDraft.ts:8`).

   Target: add `parts` and `partDefs` to `SceneVehicle` as verbatim pass-through
   alongside the existing `engine` / `attitude` / `aero` fields, copy them in
   `buildDraftFromScenario`, and re-emit them in `resolveScene`. No UI. Add a
   `resolveScene` test asserting a staged craft survives the draft round-trip.

2. Surface the craft's parts read-only in the editor panel.

   Current risk: the part-mesh pipeline bakes GLBs selected by `meshId`, with a
   primitive `PartShape` fallback when it is absent. Nothing in the editor shows which
   path a part took, so a missing or misnamed `.glb` reads as "the rocket looks a bit
   off" rather than as a load failure.

   Target: list each part with its stage and `meshId`, flagging parts on the primitive
   fallback. Read-only — this is a diagnostic, not part authoring.

3. Make `epoch` and non-parent rotation phases editable.

   Current risk: `draft.epoch` exists in the model but no UI writes it, and only the
   *parent* body's `rotationPhase` is exposed (`SceneEditor.tsx:291-304`). Authoring a
   lighting- or eclipse-sensitive scene means setting phases the editor cannot reach.

   Target: an epoch field, and per-body rotation-phase controls for the bodies in the
   draft rather than just the vehicle's parent.

## Medium Priority

1. Give authored scenes a commit path.

   Current risk: Export downloads a JSON file that the author has to hand-move into
   `public/data/scenarios/`. Round-tripping works (the export carries the `authoring`
   block, and `parseScene` accepts it), but the manual step means authored scenes tend
   not to get committed.

   Target: a dev-server write endpoint. `scenarioStorage.ts:8` already anticipates
   this — the `Store` seam is injectable specifically so a write backend drops in.

2. Support multiple vehicles per draft.

   Current risk: the draft model hard-codes a single `vehicle`, and `resolveScene`
   emits `vehicles: [vehicle]`. `buildDraftFromScenario` reads `vehicles[0]` and drops
   the rest, so any multi-craft base scenario loses everything after the first.

   Target: make the draft hold a vehicle array with a selected-vehicle index in the
   panel. Worth doing before rendezvous or station scenarios need authoring.

3. Reconsider restart-on-apply.

   Current risk: every settled edit stops and restarts the sim behind a 300 ms debounce
   (`SceneEditor.tsx:53-88`). It works, and `preserveScene: true` plus the camera-pose
   capture/restore hides most of the seam, but the mechanism exists because a full
   teardown intermittently wedged the WebGPU canvas (see
   `docs/webgpu-dispose-submit-2026-07-03.md`). Placement edits are pure — they do not
   need a sim restart.

   Target: for placement-only changes, re-seed the vehicle's state in place instead of
   restarting. Keep restart-on-apply for edits that change the body set.

## Lower Priority / Deferred

1. Editable physics config (resources, engine, attitude, aero).

   Currently carried through verbatim and annotated "this editor is placement-only"
   (`sceneDraft.ts:69`). Deliberate, and fine until part-level authoring exists.

2. `jpl-ecliptic` base scenarios.

   `full-solar-system` is excluded from the editor bases because its stored axes do not
   match the sim's y-up orbital-element convention (`appRoutes.ts:13-22`). Needs a
   frame conversion in `buildDraftFromScenario`, not an editor change.

3. Maneuver-node authoring.

   `notes/playable-roadmap.md` Epic 2 has not started. Nodes should exist in gameplay
   before the editor tries to author them.

4. Persist the initial camera pose in the draft.

   The editor captures and restores camera pose across applies but does not save it, so
   a reopened scene loses the framing it was authored against.

## Review Notes

- The editor's separation between authoring intent (`SceneDraft`) and derived runtime
  scenario (`resolveScene`) is the right shape and worth preserving — item 1 is a gap
  in the pass-through, not a flaw in the model.
- The highest-leverage sequence is item 1 (stop the data loss), then item 2 (see what
  the parts pipeline actually loaded), then item 3 (reach the phases that matter for
  the current render work).
