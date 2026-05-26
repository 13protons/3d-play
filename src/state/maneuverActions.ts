import { useManeuverStore } from './maneuver'
import { useOrbitPredictionStore } from './orbitPrediction'
import { useTrajectoriesStore } from './trajectories'
import { nearestAnomalyToPoint, timeAtAnomaly, type Vec3 } from '../sim/maneuverNode'

/**
 * Drop a maneuver node onto the most recent prediction snapshot. Anomaly may
 * come from a direct click on the orbit line (via `point`) or from a marker
 * click (`anomaly` known directly).
 */
export function placeManeuverNode(
  vehicleId: string,
  source: { kind: 'point'; pointParentRelative: Vec3 } | { kind: 'anomaly'; anomaly: number },
): void {
  const snapshot = useOrbitPredictionStore.getState().snapshots[vehicleId]
  if (!snapshot) return

  const anomaly = source.kind === 'anomaly'
    ? source.anomaly
    : nearestAnomalyToPoint(snapshot.elements, source.pointParentRelative)

  const currentSimTime = useTrajectoriesStore.getState().getSimTime()
  // Use the snapshot's simTime as the reference so the node sits on the
  // rendered orbit; advance by the relative anomaly delta.
  const simTime = timeAtAnomaly(snapshot.elements, snapshot.simTime, anomaly)
  if (simTime === null) return
  // If the user clicks the orbit segment immediately behind the vehicle,
  // timeAtAnomaly wraps to the next revolution. Allow it — they probably want
  // a full lap. But guard against landing in the past relative to now.
  if (simTime <= currentSimTime) return

  useManeuverStore.getState().setNode({
    id: `${vehicleId}-node`,
    vesselId: vehicleId,
    simTime,
    deltaV: { prograde: 0, normal: 0, radial: 0 },
    referenceElements: snapshot.elements,
    referenceSimTime: snapshot.simTime,
  })
}
