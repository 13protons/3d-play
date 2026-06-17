import type { OrbitalElements } from './orbital/kepler'
import { stateAtAnomaly, type Vec3 } from './maneuverNode'

export interface OrbitWaypoint {
  /** True anomaly along the orbit. */
  anomaly: number
  /** Position in the parent-relative frame. */
  position: Vec3
}

export interface OrbitWaypoints {
  /** Closest approach to the parent. Null for nearly-circular orbits where it has no meaning. */
  periapsis: OrbitWaypoint | null
  /** Furthest point from the parent. Null for hyperbolic/parabolic or nearly-circular orbits. */
  apoapsis: OrbitWaypoint | null
  /** Where the orbit crosses the reference plane going from -axis to +axis. Null for non-inclined. */
  ascendingNode: OrbitWaypoint | null
  /** AN + π. Null for non-inclined. */
  descendingNode: OrbitWaypoint | null
}

/** Threshold below which apoapsis/periapsis are visually indistinguishable from the orbit itself. */
const MIN_ECCENTRICITY_FOR_APSIS = 1e-3
/** Threshold below which the line of nodes is undefined. ~0.06°. */
const MIN_INCLINATION_SIN_FOR_NODES = 1e-3

/**
 * Compute the standard maneuver-planning waypoints on an orbit:
 * periapsis, apoapsis, ascending/descending nodes (relative to the
 * supplied reference axis — typically the parent body's rotation axis).
 */
export function computeOrbitWaypoints(
  elements: OrbitalElements,
  referenceAxis: Vec3,
): OrbitWaypoints {
  const { a, e, pHat, qHat } = elements
  const closed = Number.isFinite(a) && a > 0 && e < 1

  // Apsides: only meaningful for eccentric closed orbits.
  let periapsis: OrbitWaypoint | null = null
  let apoapsis: OrbitWaypoint | null = null
  if (closed && e >= MIN_ECCENTRICITY_FOR_APSIS) {
    periapsis = { anomaly: 0, position: stateAtAnomaly(elements, 0).position }
    apoapsis = { anomaly: Math.PI, position: stateAtAnomaly(elements, Math.PI).position }
  } else if (closed) {
    // For nearly-circular orbits we still want a "periapsis" pin if there's any
    // eccentricity at all — but visually it's deceiving below the threshold, so
    // we just hide both. A future enhancement could fall back to the current
    // position as "true anomaly 0" for circular orbits.
  }

  // Nodes: angle between orbit plane and reference plane.
  const pz = dot(pHat, referenceAxis)
  const qz = dot(qHat, referenceAxis)
  const sinInclination = Math.hypot(pz, qz)

  let ascendingNode: OrbitWaypoint | null = null
  let descendingNode: OrbitWaypoint | null = null
  if (closed && sinInclination >= MIN_INCLINATION_SIN_FOR_NODES) {
    // Position in orbit plane is (cos(ta) pHat + sin(ta) qHat), times r(ta).
    // Its component along referenceAxis is r*(cos(ta)*pz + sin(ta)*qz).
    // Zero crossings at ta = atan2(-pz, qz) and that + π. Of those two, the
    // ascending node is where d/dta of the axis component is positive:
    //   d/dta(cos pz + sin qz) = -sin pz + cos qz > 0
    // Substituting ta = atan2(-pz, qz):  result = sinInclination > 0. ✓
    const twoPi = 2 * Math.PI
    const taAN = ((Math.atan2(-pz, qz) % twoPi) + twoPi) % twoPi
    const taDN = (taAN + Math.PI) % twoPi
    ascendingNode = { anomaly: taAN, position: stateAtAnomaly(elements, taAN).position }
    descendingNode = { anomaly: taDN, position: stateAtAnomaly(elements, taDN).position }
  }

  return { periapsis, apoapsis, ascendingNode, descendingNode }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
