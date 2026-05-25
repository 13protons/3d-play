/**
 * Autopilot v0.1 — Attitude hold.
 *
 * Decides where the vehicle should be pointing and emits an AttitudeTarget
 * for the vehicle worker to seek. Pure functions, no I/O. Future autopilots
 * (maneuver-node execution, ascent guidance, landing) emit the same
 * AttitudeTarget shape so the vehicle worker stays a dumb attitude tracker.
 */

import type { Vec3 } from './vehicle/controls'
import {
  computeFlightReferenceFrame,
  type FlightReferenceFrame,
  type FlightReferenceFrameInput,
} from './vehicle/referenceFrame'

export type AutopilotMode =
  | 'off'
  | 'damp'
  | 'prograde'
  | 'retrograde'
  | 'normal'
  | 'antinormal'
  | 'radial-in'
  | 'radial-out'

export type AttitudeTarget =
  | { kind: 'manual' }
  | { kind: 'damp' }
  | { kind: 'seek-forward'; vector: Vec3 }

export type AutopilotInput = FlightReferenceFrameInput

export function computeAttitudeTarget(
  mode: AutopilotMode,
  input: AutopilotInput,
): AttitudeTarget {
  if (mode === 'off') return { kind: 'manual' }
  if (mode === 'damp') return { kind: 'damp' }

  const frame = computeFlightReferenceFrame(input)
  const vector = directionForMode(mode, frame)
  if (!vector) return { kind: 'damp' }
  return { kind: 'seek-forward', vector }
}

function directionForMode(
  mode: AutopilotMode,
  frame: FlightReferenceFrame,
): Vec3 | null {
  switch (mode) {
    case 'prograde':
      return normalizeOrNull(frame.navVelocity)
    case 'retrograde':
      return normalizeOrNull(negate(frame.navVelocity))
    case 'normal':
      return normalizeOrNull(frame.orbitNormal)
    case 'antinormal':
      return normalizeOrNull(negate(frame.orbitNormal))
    case 'radial-out':
      return frame.radialOut
    case 'radial-in':
      return negate(frame.radialOut)
    default:
      return null
  }
}

function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]]
}

function normalizeOrNull(v: Vec3): Vec3 | null {
  const m = Math.hypot(v[0], v[1], v[2])
  if (!(m > 0) || !Number.isFinite(m)) return null
  return [v[0] / m, v[1] / m, v[2] / m]
}
