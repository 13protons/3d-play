# Realism inventory — 2026-06-17

Snapshot of what the sim models vs. stubs across the two themes we want to
push on next: **vehicle realism** and **planetary realism**. Captured from a
codebase sweep so we can pick high-leverage work. File refs are accurate as of
this date; verify before relying on them.

## TL;DR

Strong orbital core, thin surface + vehicle-as-fixed-brick.

- **Orbital mechanics:** genuinely strong — true N-body integration (no
  patched-conic shortcut), adaptive Dormand-Prince RK4(5) at 1e-10 tol, real
  JPL body data, sector-grid precision from meters to AU.
- **Vehicle:** a fixed-mass brick — fuel never burns, single forward-only
  engine, no Isp, drag-only aero (lift/torque = 0).
- **Planets:** smooth spheres — terrain generator returns height 0; LOD tile
  infra exists but unpopulated.

**Decision (2026-06-17):** tackle **fuel-mass depletion + Isp (rocket equation)**
first — smallest contained change, highest payoff, prerequisite for staging.

## Vehicle simulation

### Modeled
- **Thrust:** constant max thrust × throttle (0–1), accel = `maxThrust/mass ×
  throttle`, applied along vehicle −Z. `src/sim/vehicle/controls.ts:412-421`,
  `src/sim/vehicle/dynamics.ts:59-68`.
- **Attitude control:** reaction wheels (torque → α via diagonal moment of
  inertia, substepped Euler), 7 SAS/autopilot hold modes with slew-rate-limited
  PD control, manual ramp/clamp. `src/sim/vehicle/controls.ts`,
  `src/sim/autopilot.ts`.
- **Aerodynamics — drag only:** quadratic drag with exponential atmosphere,
  co-rotating air velocity, load-radius gate. `src/sim/vehicle/aero.ts:62-113`.
- **Mass properties:** `mass = dryMass + fuelMass` (constant), diagonal moment
  of inertia from scenario. `src/state/vehicle.ts:65`.
- **Landing:** sphere-vs-sphere ground-contact detection; ≤10 m/s radial →
  landed (co-rotates with body), else crashed. `src/sim/vehicle/surfaceContact.ts`,
  `src/sim/vehicle/worker.ts:80`.
- **Integration:** adaptive RK4(5), state `[x,y,z,vx,vy,vz]`; attitude
  substepped at 1/60 s above 1× warp. `src/sim/integrator/adaptive.ts`.

### Stubbed / missing (gaps toward vehicle realism, ranked)
1. **No mass depletion / Isp.** `fuelMass` never decremented; every burn weighs
   the same → maneuver-node burn-time and ΔV readouts are fiction. Tsiolkovsky
   absent. `src/sim/vehicle/thrust.ts` and `parts.ts` are header-only stubs.
2. **No staging / multi-part.** `PartInstance`, `parts[]`, `stage`, and a
   `stage` command exist in `src/sim/types.ts` but never touch physics.
3. **No lift / reentry heating.** Aero torque always 0; `centerOfPressureBody`
   unused; part `temperature` never computed.
4. **No thrust vectoring / gimbal.** Single forward engine.
5. **No RCS** (reaction wheels only).
6. **Binary landing** — no legs, friction, bounce, or slope sliding.

### Design note
Vehicles have **zero gravitational mass** (influenced by gravity, produce none)
— intentional simplification, see `notes/05-physics-workers.md`.

## Planetary simulation

### Modeled
- **Bodies:** Sun, Earth, Mars, Jupiter, Saturn, Uranus, Neptune, Moon, Phobos,
  Deimos with real JPL params (mass, gm, radius, axialTilt, angularVelocity,
  soiRadius). `public/data/bodies/*.json`.
- **Gravity:** full **N-body** point-mass, all-pairs `GM/r²`, RK4(5) @ 1e-10.
  `src/sim/orbital/worker.ts:51-94`, `src/sim/integrator/derivatives.ts:21-53`.
  **No patched conics / SOI switching** — `soiRadius` used only for prediction
  clipping + warnings; vehicles never change parent. (This means interplanetary
  transfers "just work" via perturbation — the hard part is already done.)
- **Ephemeris:** numerical n-body → parent-relative cubic Hermite trajectory
  curves (~40 min validity, ~5 km error on Earth orbit). Keplerian elements
  computed for **visualization only** (`src/sim/orbital/kepler.ts`).
- **Atmosphere (physics):** exponential density, Earth only; drag-only effect.
  `src/sim/vehicle/aero.ts:54-112`, `public/data/bodies/earth.json`.
- **Rotation:** spin (`rotationPhase + angularVelocity·t`) + axial tilt; landed
  vehicles co-rotate. `src/render/rotation.ts`.
- **Lighting:** basic PBR + sun-occlusion shadowing; floating-origin rendering.
- **Coordinates:** 1000 km sector grid + local floating origin → AU-to-meter
  precision. `src/sim/constants.ts`.

### Stubbed / missing (gaps toward planetary realism, ranked)
1. **Terrain heightmaps.** `sampleSphericalTerrain()` returns height 0 — every
   surface is a smooth sphere. LOD tile infra exists but unpopulated; known perf
   stall (P1: 1536 tiles loaded at once). `src/sim/terrain.ts`,
   `src/render/terrain/terrainLodPolicy.ts`. **Biggest visual gap.**
2. **Atmosphere visuals.** No scattering/haze/glow anywhere; physics model only
   for Earth. `src/sim/orbital/atmosphere.ts` is an empty interface.
3. **Surface features / POIs** — none (deferred "Layer 3").
4. **Surface collision against real terrain** + no lat/lon/alt surface frame.
5. **Lighting fidelity** — no scattering, penumbra, or advanced optics.

## Open items from prior code review (`docs/code-review-2026-06.md`)
- **P1 (high):** terrain LOD-4 shell loads 1536 tiles at once — needs streaming
  / coarse-first.
- **P3 (med):** per-frame `useFrame` scratch allocations.
- **CL3/CL4 (low):** Vec3/quat helper + type duplication.
