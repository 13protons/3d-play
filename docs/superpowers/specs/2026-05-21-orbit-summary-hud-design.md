# Orbit Summary HUD Design

## Goal

Show the player enough orbital shape information to understand why the navball is in surface or orbital mode. The first version adds periapsis, apoapsis, and open/closed/impacting orbit state to the existing navball telemetry rows.

## First Shippable Version

The reference-frame computation owns the orbit summary. `computeFlightReferenceFrame()` already receives the relative position, relative velocity, parent GM, and parent radius used to choose surface vs orbital mode, so it should return the same orbital facts that drive that choice.

The HUD displays the summary in the existing navball row list:

- `ORB`: `CLOSED`, `OPEN`, or `IMPACT`
- `PE`: periapsis altitude relative to the parent surface, including zero or negative values for impact trajectories
- `AP`: apoapsis altitude when the conic is bound, `--` for unbound trajectories

## Orbit Summary Semantics

`OrbitSummary` has this shape:

```ts
type OrbitKind = 'closed' | 'open' | 'impacting'

interface OrbitSummary {
  kind: OrbitKind
  periapsisAltitude: number
  apoapsisAltitude: number | null
}
```

The summary returns altitudes relative to the parent surface, not center-relative radii. `apoapsisAltitude` is `null` when the conic is unbound.

`CLOSED` means the osculating two-body orbit is bound and its periapsis is above the parent radius.

`OPEN` means the osculating trajectory is unbound and its periapsis is above the parent radius.

`IMPACT` means the computed periapsis is at or below the parent radius, regardless of whether the trajectory is bound or unbound. Bound impact trajectories still report apoapsis altitude; unbound impact trajectories report `apoapsisAltitude: null`.

Parabolic and near-parabolic trajectories are treated as open when their specific orbital energy is greater than or equal to zero. This keeps apoapsis unavailable at and above escape energy.

Degenerate inputs use safe non-impacting semantics: if radius is non-positive or parent GM is non-positive, return an open summary with `periapsisAltitude: Infinity` and `apoapsisAltitude: null`. This preserves the existing behavior where invalid orbital inputs do not force surface mode.

The nav reference mode continues to use the same summary:

- landed or crashed vehicles use `surface`
- flying vehicles use `surface` when `orbit.kind === 'impacting'`
- flying vehicles use `orbital` when `orbit.kind` is `closed` or `open`

## Components

`src/sim/vehicle/referenceFrame.ts`

- Add an `OrbitSummary` type to the reference-frame module.
- Compute periapsis radius with the current angular-momentum/eccentricity formula.
- Compute apoapsis only for bound conics, including bound impact trajectories.
- Return the summary on `FlightReferenceFrame`.
- Replace the boolean `periapsisIntersectsBody()` mode gate with the summary kind.

`src/ui/flightReadout.ts`

- Keep existing altitude/speed rows unchanged.
- Add row formatting for orbit state, periapsis, and apoapsis.
- Format unavailable apoapsis as `--`.

`src/ui/HUD.tsx`

- Pass `flightReadout.frame.orbit` into `flightTelemetryRows()`.

## Testing

Add reference-frame tests for:

- circular bound orbit reports `closed`, positive PE, and positive AP
- impacting bound trajectory reports `impacting` and negative PE
- hyperbolic flyby reports `open`, positive PE, and unavailable AP
- hyperbolic impact reports `impacting`, zero-or-negative PE, and unavailable AP
- bound impact reports `impacting`, zero-or-negative PE, and available AP

Add flight-readout tests for:

- orbital rows display `ORB`, `PE`, and `AP`
- open trajectories display `AP --`

## Deferred

- Inclination, eccentricity, semimajor axis, LAN/argument of periapsis
- Time to periapsis or apoapsis
- Map-view markers
- Patched conics and sphere-of-influence transitions
- A separate orbital-elements panel
