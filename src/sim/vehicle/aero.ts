import type { Quaternion, Vec3 } from './controls'

export interface InlineAtmosphere {
  loadRadiusMultiplier: number
  model: 'exponential'
  surfaceDensity: number
  scaleHeight: number
  maxAltitude: number
}

export interface AeroForceInput {
  vehicle: {
    vehicleId: string
    parentId: string
    simTime: number
    position: Vec3
    velocity: Vec3
    orientation: Quaternion
    angularVelocity: Vec3
  }
  resources?: { dryMass: number; fuelMass: number; mass: number }
  aero?: {
    model: 'simple-drag'
    dragCoefficient: number
    referenceArea: number
    referenceLength?: number
    centerOfPressureBody?: Vec3
  }
  parent: {
    id: string
    radius: number
    position: Vec3
    velocity: Vec3
    angularVelocity: number
    rotationAxisWorld: Vec3
    atmosphere?: InlineAtmosphere
  }
}

export interface AeroForceOutput {
  forceWorld: Vec3
  torqueWorld: Vec3
  diagnostics: {
    density: number
    dynamicPressure: number
    altitude: number
    speed: number
    atmosphereVelocityWorld: Vec3
    relativeAirVelocityWorld: Vec3
    model: 'simple-drag' | 'none'
  }
}

export function exponentialAtmosphereDensity(
  atmosphere: InlineAtmosphere,
  altitude: number,
): number {
  if (altitude > atmosphere.maxAltitude) return 0
  return atmosphere.surfaceDensity * Math.exp(-Math.max(0, altitude) / atmosphere.scaleHeight)
}

export function computeAeroForce(input: AeroForceInput): AeroForceOutput {
  const relativePosition = subtract(input.vehicle.position, input.parent.position)
  const altitude = magnitude(relativePosition) - input.parent.radius
  const atmosphereVelocityWorld = add(
    input.parent.velocity,
    cross(scale(input.parent.rotationAxisWorld, input.parent.angularVelocity), relativePosition),
  )
  const relativeAirVelocityWorld = subtract(input.vehicle.velocity, atmosphereVelocityWorld)
  const speed = magnitude(relativeAirVelocityWorld)

  const zero = (density = 0, dynamicPressure = 0): AeroForceOutput => ({
    forceWorld: [0, 0, 0],
    torqueWorld: [0, 0, 0],
    diagnostics: {
      density,
      dynamicPressure,
      altitude,
      speed,
      atmosphereVelocityWorld,
      relativeAirVelocityWorld,
      model: 'none',
    },
  })

  const { atmosphere } = input.parent
  if (!input.resources || !input.aero || !atmosphere || speed <= 0) return zero()
  if (magnitude(relativePosition) > input.parent.radius * atmosphere.loadRadiusMultiplier) return zero()

  const density = exponentialAtmosphereDensity(atmosphere, altitude)
  if (density <= 0) return zero()

  const dynamicPressure = 0.5 * density * speed * speed
  const dragMagnitude = dynamicPressure * input.aero.dragCoefficient * input.aero.referenceArea
  const direction = scale(relativeAirVelocityWorld, -1 / speed)
  const forceWorld = scale(direction, dragMagnitude)

  if (!forceWorld.every(Number.isFinite)) return zero(density, dynamicPressure)

  return {
    forceWorld,
    torqueWorld: [0, 0, 0],
    diagnostics: {
      density,
      dynamicPressure,
      altitude,
      speed,
      atmosphereVelocityWorld,
      relativeAirVelocityWorld,
      model: 'simple-drag',
    },
  }
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function magnitude(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2])
}
