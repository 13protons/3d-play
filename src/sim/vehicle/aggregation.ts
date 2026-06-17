/**
 * Derive a vehicle's rigid-body properties from its part tree. The physics needs
 * mass, center of mass, an inertia tensor, and net thrust force + torque; those
 * are *computed* from the active parts, not authored. A single-part craft is the
 * degenerate case, so this generalizes the one-body model we ship today.
 *
 * Two-phase by design (see docs/multipart-design-2026-06-17.md):
 *
 *  - `buildSkeleton` walks the tree once per configuration into a "dry skeleton"
 *    — constant terms plus a per-tank inertia coefficient. Rebuild only on a
 *    staging event.
 *  - `aggregate` runs every step over just the active tanks (no tree walk),
 *    adding the fuel-linear terms so CoM drift and MoI change fall out for free.
 *
 * Pure functions, no worker state. Frames: everything is in the vehicle body
 * frame; the worker rotates net force into the world by the craft orientation.
 */

import type { PartDefinition } from './parts'
import type { PartInstance } from '../types'
import {
  type Mat3,
  type Vec3,
  MAT3_ZERO,
  mat3Add,
  mat3FromQuaternion,
  mat3Inverse,
  mat3Mul,
  mat3MulVec,
  mat3Scale,
  mat3Sub,
  mat3Transpose,
  parallelAxisTerm,
  pointMassInertiaUnit,
  vec3Add,
  vec3Cross,
  vec3Scale,
  vec3Sub,
} from './mat3'

/** Pose of a part in the vehicle body frame, resolved from the tree. */
export interface PartTransform {
  position: Vec3
  rotation: Mat3
}

/** A draining tank's fixed geometry; its fuel-linear contribution per step. */
export interface TankTerm {
  instanceId: string
  /** Tank center in the body frame (= part origin in v1). */
  position: Vec3
  /** Inertia about the origin per unit fuel mass: |r|²I − r⊗r. */
  inertiaUnit: Mat3
  /** Staging group this tank belongs to (drives which stage drains it). */
  stage: number
}

/** An active engine's geometry. Net force/torque also need throttle (dynamic). */
export interface EngineTerm {
  instanceId: string
  /** Mount point in the body frame. */
  position: Vec3
  /** Unit thrust direction in the body frame. */
  direction: Vec3
  maxThrust: number
  isp: number
  stage: number
}

/**
 * Constant-per-configuration mass terms + the lists aggregation iterates each
 * step. Rebuilt only when the active set changes (staging).
 */
export interface DrySkeleton {
  dryMass: number
  /** Σ mᵢ·rᵢ about the body origin (first moment of dry mass). */
  dryFirstMoment: Vec3
  /** Σ Iᵢ about the body origin (each part's local inertia + parallel-axis). */
  dryInertiaOrigin: Mat3
  tanks: TankTerm[]
  engines: EngineTerm[]
  /** Sum of reaction-wheel torque per body axis. */
  reactionWheelTorque: Vec3
}

/** Mass properties for one step, about the current center of mass. */
export interface VehicleAggregate {
  mass: number
  centerOfMass: Vec3
  /** Inertia tensor about the CoM, body frame. */
  inertia: Mat3
  /** Inverse inertia (null if degenerate, e.g. a single point mass). */
  inertiaInverse: Mat3 | null
}

/** Net thrust in the body frame; torque is about the CoM. */
export interface ThrustResult {
  force: Vec3
  torque: Vec3
}

const DEFAULT_THRUST_DIRECTION: Vec3 = [0, 0, 1]

function normalizeOrDefault(v: Vec3, fallback: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2])
  return m > 0 && Number.isFinite(m) ? [v[0] / m, v[1] / m, v[2] / m] : fallback
}

/**
 * Resolve each instance's body-frame pose by composing parent transforms.
 * Root parts (no parent) sit at their own local offset from the body origin.
 * A child inherits `parentPos + parentRot · localPosition` and
 * `parentRot · localRotation`. Returns a map keyed by instanceId.
 *
 * Parents are processed before children via a simple ready-set sweep, so input
 * order doesn't matter; instances with a missing/cyclic parent are skipped.
 */
export function resolvePartTransforms(parts: PartInstance[]): Map<string, PartTransform> {
  const transforms = new Map<string, PartTransform>()
  let progressed = true
  while (progressed) {
    progressed = false
    for (const part of parts) {
      if (transforms.has(part.instanceId)) continue
      const localRot = mat3FromQuaternion(part.localRotation)
      const localPos = part.localPosition
      if (part.parentInstanceId === null) {
        transforms.set(part.instanceId, { position: localPos, rotation: localRot })
        progressed = true
        continue
      }
      const parent = transforms.get(part.parentInstanceId)
      if (!parent) continue // parent not resolved yet (or absent) — retry next sweep
      transforms.set(part.instanceId, {
        position: vec3Add(parent.position, mat3MulVec(parent.rotation, localPos)),
        rotation: mat3Mul(parent.rotation, localRot),
      })
      progressed = true
    }
  }
  return transforms
}

/**
 * Walk the active parts once into a dry skeleton. Each part contributes its dry
 * mass, first moment, and inertia (rotated into the body frame, then shifted to
 * the origin by parallel-axis). Tanks and engines are collected with their
 * resolved geometry. Inactive parts (jettisoned / disabled) are excluded.
 */
export function buildSkeleton(
  parts: PartInstance[],
  definitions: Map<string, PartDefinition>,
): DrySkeleton {
  const transforms = resolvePartTransforms(parts)
  let dryMass = 0
  let dryFirstMoment: Vec3 = [0, 0, 0]
  let dryInertiaOrigin: Mat3 = MAT3_ZERO
  let reactionWheelTorque: Vec3 = [0, 0, 0]
  const tanks: TankTerm[] = []
  const engines: EngineTerm[] = []

  for (const part of parts) {
    if (!part.active) continue
    const def = definitions.get(part.defId)
    const transform = transforms.get(part.instanceId)
    if (!def || !transform) continue
    const { position, rotation } = transform

    dryMass += def.dryMass
    dryFirstMoment = vec3Add(dryFirstMoment, vec3Scale(position, def.dryMass))
    // Rotate the part's local inertia into the body frame (R·I·Rᵀ), then shift
    // from the part origin to the body origin via parallel-axis.
    const inertiaBody = mat3Mul(mat3Mul(rotation, def.inertia), mat3Transpose(rotation))
    dryInertiaOrigin = mat3Add(
      dryInertiaOrigin,
      mat3Add(inertiaBody, parallelAxisTerm(def.dryMass, position)),
    )

    for (const mod of def.modules) {
      if (mod.kind === 'tank') {
        tanks.push({ instanceId: part.instanceId, position, inertiaUnit: pointMassInertiaUnit(position), stage: part.stage })
      } else if (mod.kind === 'engine') {
        engines.push({
          instanceId: part.instanceId,
          position,
          direction: mat3MulVec(rotation, normalizeOrDefault(mod.thrustDirection ?? DEFAULT_THRUST_DIRECTION, DEFAULT_THRUST_DIRECTION)),
          maxThrust: mod.maxThrust,
          isp: mod.isp,
          stage: part.stage,
        })
      } else if (mod.kind === 'reactionWheel') {
        reactionWheelTorque = vec3Add(reactionWheelTorque, mod.torque)
      }
    }
  }

  return { dryMass, dryFirstMoment, dryInertiaOrigin, tanks, engines, reactionWheelTorque }
}

/**
 * Per-step mass properties: dry skeleton + the fuel-linear terms from each
 * active tank's current fuel. O(active tanks), no tree walk. `fuelByInstanceId`
 * gives the current propellant in each tank (missing → 0).
 */
export function aggregate(
  skeleton: DrySkeleton,
  fuelByInstanceId: Map<string, number>,
): VehicleAggregate {
  let mass = skeleton.dryMass
  let firstMoment = skeleton.dryFirstMoment
  let inertiaOrigin = skeleton.dryInertiaOrigin

  for (const tank of skeleton.tanks) {
    const fuel = fuelByInstanceId.get(tank.instanceId) ?? 0
    if (fuel <= 0) continue
    mass += fuel
    firstMoment = vec3Add(firstMoment, vec3Scale(tank.position, fuel))
    inertiaOrigin = mat3Add(inertiaOrigin, mat3Scale(tank.inertiaUnit, fuel))
  }

  const centerOfMass: Vec3 = mass > 0 ? vec3Scale(firstMoment, 1 / mass) : [0, 0, 0]
  // Shift the origin-referenced inertia to the CoM (reverse parallel-axis).
  const inertia = mass > 0
    ? mat3Sub(inertiaOrigin, parallelAxisTerm(mass, centerOfMass))
    : inertiaOrigin

  return { mass, centerOfMass, inertia, inertiaInverse: mat3Inverse(inertia) }
}

/**
 * Net thrust force and torque (about the CoM) in the body frame for the given
 * engines at a single throttle. Symmetric stacks net ~zero torque; lopsided or
 * gimballed layouts get the right couple. Engine directions are fixed here
 * (gimbal steering is a later slice). Callers filter `engines` to the firing set.
 */
export function netThrust(engines: EngineTerm[], centerOfMass: Vec3, throttle: number): ThrustResult {
  if (throttle <= 0) return { force: [0, 0, 0], torque: [0, 0, 0] }
  let force: Vec3 = [0, 0, 0]
  let torque: Vec3 = [0, 0, 0]
  for (const engine of engines) {
    const f = vec3Scale(engine.direction, engine.maxThrust * throttle)
    force = vec3Add(force, f)
    torque = vec3Add(torque, vec3Cross(vec3Sub(engine.position, centerOfMass), f))
  }
  return { force, torque }
}
