# Navball Cardinal Ticks Design

## Goal

Make the navball easier to orient by adding body-dependent N/E/S/W compass ticks and labels.

## First Shippable Version

Use the nearby parent body's local surface frame. The compass is not screen-fixed and not orbit-frame-fixed.

- Up is the normalized vehicle-to-parent radial-out vector.
- North is the parent rotation axis projected onto the local tangent plane.
- South is the inverse of north.
- East is `cross(north, up)`, matching the direction of positive body rotation.
- West is the inverse of east.

The navball projects these four world-space directions through the same craft-orientation projection path as existing prograde/radial/normal markers. This keeps the cardinal labels tied to the same displayed attitude frame as the rest of the navball.

## Polar Degeneracy

At or near a pole, projecting the rotation axis onto the local tangent plane can become zero length. In that case, omit all cardinal ticks rather than showing arbitrary or misleading labels.

Also omit all cardinal ticks when `relativePosition` or `parentRotationAxis` is zero-length or non-finite. Do not fall back to arbitrary axes for compass labels.

## UI

Add subtle N/E/S/W labels and short tick marks clipped inside the navball sphere. They should be less prominent than prograde/retrograde markers and should not replace the existing horizon or marker symbols.

The existing orbital-normal marker already uses `N`. Compass labels must be visually distinct from marker bubbles: render cardinal directions as small perimeter tick labels without filled marker circles, using subdued color and smaller type.

## Components

`src/ui/navballMath.ts`

- Add a compass-frame helper that accepts `relativePosition` and `parentRotationAxis` and returns world-space N/E/S/W unit vectors, or `null` when degenerate.
- Add projected compass points to `NavballState` by passing those world-space vectors through the existing `worldToCraft` and `projectNavballVector` path.
- Include tests for equator, inverse directions, and pole omission.

`src/ui/Navball.tsx`

- Accept `parentRotationAxis` in `Navball` and `NavballCluster`.
- Render visible cardinal labels and short ticks.

`src/ui/HUD.tsx`

- Pass `flightReadout.frame.parentRotationAxis` or the locally computed parent rotation axis into `NavballCluster`.

`src/sim/vehicle/referenceFrame.ts`

- Return `parentRotationAxis` on `FlightReferenceFrame` if that keeps HUD/Navball wiring simpler and avoids recomputing the axis.

## Testing

- Unit-test compass vector generation in `navballMath.ts`.
- Unit-test projection output enough to verify N/E/S/W are visible/invisible consistently with existing marker projection rules.
- Typecheck and lint changed files.

## Deferred

- Heading tape or numeric heading.
- Latitude/longitude readouts.
- Magnetic/true north distinction.
- Runway/course guidance.
- Compass behavior for non-rotating bodies beyond safe omission when the axis is unusable.
