import type { VehicleControlMeta } from '../state/trajectories'

export interface AttitudeAxisDiagnostic {
  /** Human-readable axis name. */
  label: string
  /** Reaction-wheel torque actually commanded this tick (N·m, signed). */
  commanded: number
  /** Maximum reaction-wheel torque available on this axis (N·m). */
  available: number
  /** |commanded| / available, clamped to [0, 1]. 1 means the wheel is saturated. */
  saturation: number
  /** Angular rate about this axis (rad/s, signed). */
  angularRate: number
}

const AXIS_LABELS = ['Pitch', 'Yaw', 'Roll'] as const

/**
 * Per-axis attitude-control diagnostics: how much of the available reaction-wheel
 * torque the autopilot is commanding, and the resulting body angular rate. Used
 * to visualize commanded-vs-available torque while tuning the controller.
 *
 * Returns null when the vehicle has no reaction-wheel torque data (uncontrollable
 * craft), since saturation has no meaning without an available-torque reference.
 */
export function attitudeDiagnostics(
  control: Pick<VehicleControlMeta, 'commandedTorque' | 'reactionWheelTorque' | 'angularVelocity'>,
): AttitudeAxisDiagnostic[] | null {
  const available = control.reactionWheelTorque
  if (!available) return null
  const commanded = control.commandedTorque ?? [0, 0, 0]
  const rate = control.angularVelocity ?? [0, 0, 0]
  return AXIS_LABELS.map((label, axis) => {
    const max = available[axis]
    const cmd = commanded[axis] ?? 0
    const saturation = max > 0 ? Math.min(1, Math.abs(cmd) / max) : 0
    return {
      label,
      commanded: cmd,
      available: max,
      saturation,
      angularRate: rate[axis] ?? 0,
    }
  })
}
