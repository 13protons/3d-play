import type { OrbitSummary } from '../sim/vehicle/referenceFrame'

type Vec3 = [number, number, number]
export type AttitudeMode = 'manual' | 'hold-current' | 'retrograde'

export interface FlightReadoutInput {
  vehiclePosition: Vec3
  vehicleVelocity: Vec3
  parentPosition: Vec3
  parentVelocity: Vec3
  parentRadius: number
  referenceVelocity?: Vec3
}

export interface FlightReadout {
  altitude: number
  speed: number
  radialSpeed: number
}

export interface FlightTelemetryRow {
  label: string
  value: string
}

export function computeFlightReadout({
  vehiclePosition,
  vehicleVelocity,
  parentPosition,
  parentVelocity,
  parentRadius,
  referenceVelocity,
}: FlightReadoutInput): FlightReadout {
  const relPos = subtract(vehiclePosition, parentPosition)
  const relVel = referenceVelocity ?? subtract(vehicleVelocity, parentVelocity)
  const distance = mag(relPos)
  const radialUnit = distance > 0 ? scale(relPos, 1 / distance) : [1, 0, 0] as Vec3

  return {
    altitude: distance - parentRadius,
    speed: mag(relVel),
    radialSpeed: dot(relVel, radialUnit),
  }
}

export function formatFlightNumber(value: number, unit: 'm' | 'm/s'): string {
  const displayValue = Math.abs(value) < 0.5 ? 0 : value
  const abs = Math.abs(displayValue)
  if (unit === 'm') {
    if (abs >= 10_000) return `${(displayValue / 1000).toFixed(1)} km`
    return `${displayValue.toFixed(0)} m`
  }

  if (abs >= 1_000) return `${(displayValue / 1000).toFixed(1)} km/s`
  return `${displayValue.toFixed(0)} m/s`
}

export function flightTelemetryRows({
  readout,
  mass,
  orbit,
}: {
  readout: FlightReadout
  throttle: number
  angularVelocity: Vec3
  surfaceState: 'flying' | 'landed' | 'crashed'
  attitudeMode?: AttitudeMode
  mass?: number
  maxThrust?: number
  orbit?: OrbitSummary
}): FlightTelemetryRow[] {
  const rows: FlightTelemetryRow[] = [
    { label: 'ALT', value: formatFlightNumber(readout.altitude, 'm') },
    { label: 'VEL', value: formatFlightNumber(readout.speed, 'm/s') },
    { label: 'VERT', value: formatFlightNumber(readout.radialSpeed, 'm/s') },
  ]
  if (mass !== undefined) rows.push({ label: 'MASS', value: `${mass.toFixed(0)} kg` })
  if (orbit) {
    const orbitLabel = orbit.kind === 'impacting' ? 'IMPACT' : orbit.kind.toUpperCase()
    rows.push(
      { label: 'ORB', value: orbitLabel },
      { label: 'PE', value: formatFlightNumber(orbit.periapsisAltitude, 'm') },
      {
        label: 'AP',
        value: orbit.apoapsisAltitude === null ? '--' : formatFlightNumber(orbit.apoapsisAltitude, 'm'),
      },
    )
  }
  return rows
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function mag(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}
