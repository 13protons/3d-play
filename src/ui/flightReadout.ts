type Vec3 = [number, number, number]

export interface FlightReadoutInput {
  vehiclePosition: Vec3
  vehicleVelocity: Vec3
  parentPosition: Vec3
  parentVelocity: Vec3
  parentRadius: number
}

export interface FlightReadout {
  altitude: number
  speed: number
  radialSpeed: number
}

export function computeFlightReadout({
  vehiclePosition,
  vehicleVelocity,
  parentPosition,
  parentVelocity,
  parentRadius,
}: FlightReadoutInput): FlightReadout {
  const relPos = subtract(vehiclePosition, parentPosition)
  const relVel = subtract(vehicleVelocity, parentVelocity)
  const distance = mag(relPos)
  const radialUnit = distance > 0 ? scale(relPos, 1 / distance) : [1, 0, 0] as Vec3

  return {
    altitude: distance - parentRadius,
    speed: mag(relVel),
    radialSpeed: dot(relVel, radialUnit),
  }
}

export function formatFlightNumber(value: number, unit: 'm' | 'm/s'): string {
  const abs = Math.abs(value)
  if (unit === 'm') {
    if (abs >= 10_000) return `${(value / 1000).toFixed(1)} km`
    return `${value.toFixed(0)} m`
  }

  if (abs >= 1_000) return `${(value / 1000).toFixed(1)} km/s`
  return `${value.toFixed(0)} m/s`
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
