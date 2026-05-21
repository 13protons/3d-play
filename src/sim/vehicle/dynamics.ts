import type { DerivFn } from '../integrator/adaptive'
import type { TrajectoryCurve } from '../types'
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

    const parentPosition = sampleCurvePosition(parentCurve, t)
    const parentVelocity = sampleCurveVelocity(parentCurve, t)
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

function sampleCurvePosition(curve: TrajectoryCurve, t: number): Vec3 {
  const dt = curve.t1 - curve.t0
  if (dt === 0) return curve.p1
  const s = (t - curve.t0) / dt
  const s2 = s * s
  const s3 = s2 * s
  const h00 = 2 * s3 - 3 * s2 + 1
  const h10 = s3 - 2 * s2 + s
  const h01 = -2 * s3 + 3 * s2
  const h11 = s3 - s2
  return [
    h00 * curve.p0[0] + h10 * dt * curve.v0[0] + h01 * curve.p1[0] + h11 * dt * curve.v1[0],
    h00 * curve.p0[1] + h10 * dt * curve.v0[1] + h01 * curve.p1[1] + h11 * dt * curve.v1[1],
    h00 * curve.p0[2] + h10 * dt * curve.v0[2] + h01 * curve.p1[2] + h11 * dt * curve.v1[2],
  ]
}

function sampleCurveVelocity(curve: TrajectoryCurve, t: number): Vec3 {
  const dt = curve.t1 - curve.t0
  if (dt === 0) return curve.v1
  const s = (t - curve.t0) / dt
  const s2 = s * s
  const dh00 = 6 * s2 - 6 * s
  const dh10 = 3 * s2 - 4 * s + 1
  const dh01 = -6 * s2 + 6 * s
  const dh11 = 3 * s2 - 2 * s
  return [
    (dh00 * curve.p0[0]) / dt + dh10 * curve.v0[0] + (dh01 * curve.p1[0]) / dt + dh11 * curve.v1[0],
    (dh00 * curve.p0[1]) / dt + dh10 * curve.v0[1] + (dh01 * curve.p1[1]) / dt + dh11 * curve.v1[1],
    (dh00 * curve.p0[2]) / dt + dh10 * curve.v0[2] + (dh01 * curve.p1[2]) / dt + dh11 * curve.v1[2],
  ]
}
