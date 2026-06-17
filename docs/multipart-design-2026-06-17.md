# Multi-part vehicles — design (2026-06-17)

Design for turning a vehicle from a single hand-authored rigid body into a tree
of parts whose rigid-body properties are *derived* from the tree. This is the
keystone for staging, thrust vectoring, aero stability, and reentry/thermal.

## Principle

A vehicle is a **tree of parts**. The physics needs a rigid body — mass, center
of mass, inertia tensor, net force, net torque, drag. Those are **derived from
the active parts**, not authored. The single-body craft we ship today is just
the degenerate 1-part configuration, so the per-stage rocket equation
generalizes the one already in `thrust.ts`.

Everything lives in the **vehicle worker** (it already owns vehicle state and
runs integration). Only a lightweight render manifest crosses to the main thread
to draw the craft. See "Worker / render split" below.

## Decisions locked

- **Full 3×3 inertia tensor** (not diagonal) — honest for asymmetric/off-axis
  craft; requires reworking the attitude integrator (see below).
- **Incremental aggregation** — do NOT re-walk the tree every frame. Cache a
  per-configuration "dry skeleton"; per step update only fuel-dependent terms;
  full rebuild only on a staging event.
- **Net thrust torque included in the spine** (engines at their mount points,
  fixed directions). Gimbal *steering control* is a later slice.
- **v1 simplifications:** tank propellant = point mass at tank center (no
  ullage); each stage's engines draw proportionally from that stage's tanks, no
  crossfeed across decouplers; jettisoned parts vanish (no debris tracking yet);
  staging lands on a step boundary.

## Data model: definitions vs. instances vs. modules

- **PartDefinition** (catalog, static, shared — NEW): dry mass, mesh id, attach
  points, local inertia, and a list of **modules**. "What a part is."
- **PartInstance** (`src/sim/types.ts:184`, exists, close): which def, tree
  placement (`parentInstanceId`, attach points, `localPosition`/`localRotation`),
  `stage`, runtime state (`fuel`, `temperature`, `active`). "Where this part is
  and its current state."
- **Modules** (NEW): the behaviors a part contributes — `tank`, `engine`,
  `reactionWheel`, `rcs`, `decoupler`, `landingLeg`, `command`, `structural`. A
  part may have several. This is what aggregation reads.

`VesselPhysics` (`types.ts:199`) already has `parts[]` + `currentStage`; the
`stage` command exists (`types.ts:36`). Both are currently unused.

## Incremental aggregation

The tree is static; the only continuously-varying inputs are fuel levels in the
draining tanks. Split the work:

**Per configuration (rebuilt only on staging) — the "dry skeleton":**
- `dryMass`
- `dryFirstMoment` = Σ mᵢ·rᵢ (about a fixed vehicle origin)
- `dryInertiaOrigin` = Σ Iᵢ about origin (each part's local inertia +
  parallel-axis to origin)
- active tank list: each `{ r, J }` (position + inertia coefficient about origin)
- active engine list: each `{ r, dir, thrust, isp, tankIds }`

**Per step (O(active tanks), no tree walk):** aggregate = dry skeleton + terms
linear in each tank's current fuel `fᵢ`:
- `mass = dryMass + Σ fᵢ`
- `CoM = (dryFirstMoment + Σ fᵢ·rᵢ) / mass`
- `inertiaOrigin = dryInertiaOrigin + Σ fᵢ·Jᵢ`
- `inertiaCoM = inertiaOrigin − parallelAxis(mass, CoM)` (one shift)

CoM drift and MoI change as fuel burns fall out for free. Staging is the only
trigger for a full skeleton rebuild.

## Full tensor → attitude integrator rework

The attitude path today does per-axis `τ/I` (diagonal MoI, no coupling). Full
tensor means **Euler's rotational equation**:

    ω̇ = I⁻¹ (τ − ω × (I ω))

using the incrementally-updated `I` and `I⁻¹`. This reworks
`integrateAttitudeOverStep` and the SAS/slew controller in
`src/sim/vehicle/controls.ts`, which currently assume diagonal MoI. The
translation integrator and curve emission are unaffected. This is the main
non-obvious chunk of work.

## Thrust & forces

- **Net thrust force** = Σ active engines' thrust vectors, applied at the CoM.
- **Net thrust torque** = Σ (rᵢ − CoM) × Fᵢ. Nearly free given aggregation;
  symmetric stacks net ~0, lopsided ones get the right torque. Engine directions
  fixed for the spine; gimbal control deferred.
- Aggregate drag / center-of-pressure (for aero stability) is a later slice.

## Resource modeling

- Propellant moves from one global pool to **per-tank pools**.
- Engines draw from their stage's tanks (proportional draw, no crossfeed across
  decouplers in v1). Draw order drives CoM shift.
- **ΔV becomes per-stage**: each stage's ΔV = its engines' Isp × ln(stageWet /
  stageDry); total = Σ. RESOURCES panel + maneuver budget become a per-stage
  readout.
- Resource *types* (LF/Ox/monoprop/EC) are a later widening; v1 = one propellant.

## Staging

- The `stage` command (`types.ts:36`) advances `currentStage`, fires that
  stage's decouplers (jettison parts at/below them), and activates the next
  engines.
- A staging event triggers a **skeleton rebuild** (new active set), updates
  mass / per-stage ΔV, and emits a **structural-sync event** to the outside tree
  mirror (see "Tree ownership & worker / render split").
- Jettisoned parts vanish in v1 (debris-as-tracked-bodies later).
- Must land on an integration step boundary so the discontinuity is clean.

## Tree ownership & worker / render split

The vehicle tree (parts + stage boundaries) is **authored outside the worker**
(from scenario JSON) and passed in at init. Both sides therefore hold the tree:
the worker runs physics on its copy; the main thread keeps it as the canonical
**render model** (in the vehicle store, drawn by `src/render/Vessel.tsx`, whose
stub header already says "assembles part meshes according to the part tree").

Structural changes are a **sync protocol**, not a re-pushed manifest. The worker
is authoritative for *when* they happen (it resolves them on a step boundary
from physics state), so they flow worker → outside as small events that mutate
the mirror:

- **Staging** → "stage N fired; parts [ids] jettisoned." Outside drops those
  meshes; both copies recompute their active set identically.
- **Damage** (later) → "part X destroyed." Same pattern.

Because both copies start from the same tree and apply the same structural
events, they stay in sync without shipping the whole tree each time.

What actually crosses the boundary:
- **Init:** full tree + part defs, outside → worker (once).
- **Structural events:** staging/damage, worker → outside (rare, event-based).
- **World transform:** vehicle trajectory curve + `vehicle-controls.orientation`
  — already flows, per-frame, unchanged. `Vessel.tsx` places/orients the
  assembled part group from it.
- **Dynamic visual flags:** engine-firing + throttle (plumes), part temperature
  (glow) — piggyback on the existing `vehicle-controls` message.

Heavy physics (cache, aggregation, mass/CoM/inertia) stays entirely in the
worker and never crosses — only structural events and the transform do.

## v1 scope (the spine) and build order

In scope: JSON-authored part trees → aggregation (mass/CoM/inertia/thrust force
+ torque) → full-tensor attitude → staging that drops parts → per-stage ΔV in
the UI → render manifest feeding `Vessel.tsx`.

Suggested build order:
1. Pure aggregation module (+ tests) — skeleton build + per-step fuel update,
   full tensor, parallel-axis. Self-contained, no worker changes.
2. Attitude integrator → Euler's equation with full `I`/`I⁻¹` (+ tests).
3. Worker wiring: init sends part tree + defs; build cache; per-step aggregate
   feeds translation + attitude; fuel drains per-tank.
4. Staging: `stage` command → rebuild + re-emit.
5. UI: per-stage ΔV / RESOURCES from the new aggregate.
6. Render: tree authored outside + passed to worker at init; `Vessel.tsx`
   assembles part meshes from the outside mirror; staging structural-sync events
   keep the mirror current.

## Deferred (bolt onto the spine later)

Gimbal steering control · aero center-of-pressure / stability · reentry heating
& part failure (the `temperature` field) · structural/max-Q breakup · landing
legs as contact points · electric charge / RCS propellant · debris as tracked
bodies · crossfeed & resource types · a VAB-style build editor · joint flex
(explicitly NOT doing — rigid aggregate only).
