import type { DerivFn } from '../integrator/adaptive'
import type { TrajectoryCurve } from '../types'
import { evaluateCurve, evaluateCurveVelocity } from '../curves'
import { computeAeroForce, type InlineAtmosphere } from './aero'
import {
  thrustAccelerationForElapsedRotation,
  type Quaternion,
  type ThrustModel,
  type Vec3,
} from './controls'

export interface VehicleSurfaceEnvironment {
  radius: number
  angularVelocity: number
  rotationAxis: Vec3
  atmosphere?: InlineAtmosphere
}

export interface VehicleResources {
  dryMass: number
  fuelMass: number
  mass: number
}

export interface VehicleEngine {
  maxThrust: number
}

export interface VehicleAero {
  model: 'simple-drag'
  dragCoefficient: number
  referenceArea: number
  referenceLength?: number
  centerOfPressureBody?: Vec3
}

export interface VehicleDerivativeOptions {
  gravity: DerivFn
  parentId: string
  bodyCurves: TrajectoryCurve[]
  bodySurfaces: Map<string, VehicleSurfaceEnvironment>
  resources?: VehicleResources
  engine?: VehicleEngine
  aero?: VehicleAero
  orientation: Quaternion
  angularVelocity: Vec3
  throttle: number
  simTime: number
  onAeroForce?: (force: Vec3) => void
}

export function vehicleDerivatives(options: VehicleDerivativeOptions): DerivFn {
  return (t: number, y: Float64Array, dydt: Float64Array): void => {
    options.gravity(t, y, dydt)

    const thrustModel: ThrustModel | undefined = options.resources && options.engine
      ? { maxThrust: options.engine.maxThrust, mass: options.resources.mass }
      : undefined
    const thrust = thrustAccelerationForElapsedRotation(
      options.orientation,
      options.angularVelocity,
      t - options.simTime,
      options.throttle,
      thrustModel,
    )
    dydt[3] += thrust[0]
    dydt[4] += thrust[1]
    dydt[5] += thrust[2]

    const parentCurve = options.bodyCurves.find((curve) => curve.id === options.parentId)
    const parentSurface = options.bodySurfaces.get(options.parentId)
    if (!parentCurve || !parentSurface || !options.resources || !options.aero) return

    const parentPosition = evaluateCurve(parentCurve, t)
    const parentVelocity = evaluateCurveVelocity(parentCurve, t)
    const force = computeAeroForce({
      vehicle: {
        vehicleId: 'vehicle',
        parentId: options.parentId,
        simTime: t,
        position: [y[0], y[1], y[2]],
        velocity: [y[3], y[4], y[5]],
        orientation: options.orientation,
        angularVelocity: options.angularVelocity,
      },
      resources: options.resources,
      aero: options.aero,
      parent: {
        id: options.parentId,
        radius: parentSurface.radius,
        position: parentPosition,
        velocity: parentVelocity,
        angularVelocity: parentSurface.angularVelocity,
        rotationAxisWorld: parentSurface.rotationAxis,
        atmosphere: parentSurface.atmosphere,
      },
    }).forceWorld
    options.onAeroForce?.(force)

    dydt[3] += force[0] / options.resources.mass
    dydt[4] += force[1] / options.resources.mass
    dydt[5] += force[2] / options.resources.mass
  }
}
