/**
 * Part catalog: what a part *is*. A `PartDefinition` is static, shared, and
 * referenced by `PartInstance.defId` (`src/sim/types.ts`); an instance adds tree
 * placement and runtime state. The behaviours a part contributes are its
 * `modules` — this is what mass aggregation, thrust, and staging read.
 *
 * v1 simplifications: a part's `inertia` is about its own origin, which is also
 * taken as its dry center of mass; a tank's propellant is a point mass at that
 * same origin (no ullage).
 */

import type { Mat3, Vec3 } from './mat3'

/** A tank holds propellant; the engines of its stage draw from it. */
export interface TankModule {
  kind: 'tank'
  /** Maximum propellant mass (kg). */
  capacity: number
  /** Resource id for later multi-propellant support; v1 has one unnamed pool. */
  resourceId?: string
}

/** An engine produces thrust along `thrustDirection` (local, default +Z). */
export interface EngineModule {
  kind: 'engine'
  maxThrust: number
  /** Specific impulse (s). */
  isp: number
  /** Thrust axis in the part's local frame; normalized at skeleton build. */
  thrustDirection?: Vec3
}

/** A decoupler is the cut point a stage fires to jettison everything below it. */
export interface DecouplerModule {
  kind: 'decoupler'
}

/** A reaction wheel contributes attitude-control torque about the vehicle axes. */
export interface ReactionWheelModule {
  kind: 'reactionWheel'
  /** Peak torque per body axis (N·m). */
  torque: Vec3
}

export type PartModule =
  | TankModule
  | EngineModule
  | DecouplerModule
  | ReactionWheelModule

/** Render hint for the part (ignored by physics; consumed by Vessel.tsx). */
export interface PartRender {
  shape: 'cylinder' | 'box' | 'cone'
  /** Radius (cylinder/cone) or half-width (box), in metres. */
  radius?: number
  /** Length along the part's local +Z, in metres. */
  length?: number
  color?: string
}

export interface PartDefinition {
  id: string
  /** Structural (dry) mass, kg. */
  dryMass: number
  /** Mesh id used by the renderer. */
  meshId?: string
  /** Inertia tensor about the part's own origin, in its local frame (kg·m²). */
  inertia: Mat3
  modules: PartModule[]
  render?: PartRender
}
