import type { DerivFn } from '../integrator/adaptive'
import type { TrajectoryCurve } from '../types'
import { evaluateCurve, evaluateCurveVelocity } from '../curves'
import { computeAeroForce, type InlineAtmosphere } from './aero'
import {
  thrustAccelerationForElapsedRotation,
  thrustAccelerationFromBodyForce,
  type Quaternion,
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
  /** Specific impulse (s) — sets propellant flow via ṁ = F/(Isp·g₀). */
  isp: number
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
  /**
   * Net thrust force in the body frame (the aggregation spine's summed engines).
   * When supplied it replaces the single-engine `engine`/`throttle` model;
   * `thrustMass` is the current total vehicle mass it acts on.
   */
  thrustBodyForce?: Vec3
  thrustMass?: number
}

export function vehicleDerivatives(options: VehicleDerivativeOptions): DerivFn {
  return (t: number, y: Float64Array, dydt: Float64Array): void => {
    options.gravity(t, y, dydt)

    // Spine path: a body-frame net thrust force (summed engines). Falls back to
    // the single-engine +Z model when no aggregated force is supplied.
    const thrust = options.thrustBodyForce && options.thrustMass !== undefined
      ? thrustAccelerationFromBodyForce(
          options.thrustBodyForce,
          options.thrustMass,
          options.orientation,
          options.angularVelocity,
          t - options.simTime,
        )
      : thrustAccelerationForElapsedRotation(
          options.orientation,
          options.angularVelocity,
          t - options.simTime,
          options.throttle,
          options.resources && options.engine
            ? { maxThrust: options.engine.maxThrust, mass: options.resources.mass }
            : undefined,
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
