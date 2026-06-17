/**
 * The vehicle worker's mutable structural model: the part tree plus per-tank
 * fuel, wrapping the pure aggregation in `aggregation.ts`. It owns the "what is
 * the craft right now" state — fuel drains into it, staging mutates it — and
 * hands the integrator mass properties, net thrust, and control limits.
 *
 * The single-body craft we ship today is the degenerate 1-part configuration:
 * `VehicleStructure.singleBody(...)` builds a one-part tree (tank + engine +
 * reaction wheel, all at the origin) whose aggregate reproduces the old model
 * exactly — constant inertia, CoM at the origin, thrust along +Z through the
 * CoM with zero torque. So wiring this in changes no numbers for current
 * scenarios; multi-part behaviour only appears once a real tree is authored.
 */

import {
  type DrySkeleton,
  type EngineTerm,
  type ThrustResult,
  type VehicleAggregate,
  aggregate,
  buildSkeleton,
  netThrust,
  netThrustGimbaled,
  solveGimbalForTorque,
} from './aggregation'
import type { PartDefinition } from './parts'
import type { PartInstance, StageSummary } from '../types'
import type { Vec3 } from './mat3'
import { deltaVBudget } from './thrust'

export type { StageSummary }

export interface SingleBodyConfig {
  dryMass: number
  fuelMass: number
  maxThrust: number
  isp: number
  reactionWheelTorque?: Vec3
}

const SINGLE_BODY_DEF = 'single-body'
const SINGLE_BODY_INSTANCE = 'root'

export class VehicleStructure {
  private parts: PartInstance[]
  private definitions: Map<string, PartDefinition>
  private skeleton: DrySkeleton
  /** Current propellant per tank instance id. */
  private fuel: Map<string, number>
  currentStage: number

  constructor(parts: PartInstance[], definitions: Map<string, PartDefinition>, currentStage = 0) {
    this.parts = parts
    this.definitions = definitions
    this.currentStage = currentStage
    this.skeleton = buildSkeleton(parts, definitions)
    this.fuel = new Map(this.skeleton.tanks.map((t) => [t.instanceId, initialFuel(parts, definitions, t.instanceId)]))
  }

  /** Degenerate single-part craft equivalent to the legacy single-body model. */
  static singleBody(config: SingleBodyConfig): VehicleStructure {
    const def: PartDefinition = {
      id: SINGLE_BODY_DEF,
      dryMass: config.dryMass,
      // Inertia is supplied per-step by the worker's diagonal MoI; the spine's
      // own tensor is built from geometry, which for a point-at-origin part is
      // zero. The worker keeps using its authored diagonal MoI for this case.
      inertia: [0, 0, 0, 0, 0, 0, 0, 0, 0],
      modules: [
        { kind: 'tank', capacity: config.fuelMass },
        { kind: 'engine', maxThrust: config.maxThrust, isp: config.isp },
        ...(config.reactionWheelTorque ? [{ kind: 'reactionWheel' as const, torque: config.reactionWheelTorque }] : []),
      ],
    }
    const part: PartInstance = {
      instanceId: SINGLE_BODY_INSTANCE,
      defId: SINGLE_BODY_DEF,
      parentInstanceId: null,
      parentAttachPointId: null,
      myAttachPointId: 'root',
      localPosition: [0, 0, 0],
      localRotation: [0, 0, 0, 1],
      fuel: config.fuelMass,
      stage: 0,
      active: true,
    }
    return new VehicleStructure([part], new Map([[def.id, def]]))
  }

  /** Mass properties for the current fuel state (all active parts). */
  aggregate(): VehicleAggregate {
    return aggregate(this.skeleton, this.fuel)
  }

  /** Engines firing this step — those on parts in the current stage. */
  get engines(): EngineTerm[] {
    return this.skeleton.engines.filter((e) => e.stage === this.currentStage)
  }

  /** Tanks feeding the firing engines (current stage). */
  private get firingTanks() {
    return this.skeleton.tanks.filter((t) => t.stage === this.currentStage)
  }

  /** Summed reaction-wheel torque per body axis. */
  get reactionWheelTorque(): Vec3 {
    return this.skeleton.reactionWheelTorque
  }

  /** Total propellant across every tank (for display / total ΔV). */
  totalFuel(): number {
    let sum = 0
    for (const f of this.fuel.values()) sum += f
    return sum
  }

  /** Propellant available to the firing stage. */
  stageFuel(): number {
    let sum = 0
    for (const t of this.firingTanks) sum += this.fuel.get(t.instanceId) ?? 0
    return sum
  }

  /** Summed max thrust of the firing engines (for fuel-flow bookkeeping). */
  totalMaxThrust(): number {
    let sum = 0
    for (const e of this.engines) sum += e.maxThrust
    return sum
  }

  /** Representative Isp (v1 assumes the firing engines share one). */
  isp(): number {
    return this.engines[0]?.isp ?? 0
  }

  /** Net thrust force + torque (about the CoM) in the body frame. */
  netThrustBody(throttle: number, centerOfMass: Vec3): ThrustResult {
    return netThrust(this.engines, centerOfMass, throttle)
  }

  /** Gimbal command realizing a desired pitch/yaw torque about the CoM. */
  solveGimbal(centerOfMass: Vec3, throttle: number, desiredX: number, desiredY: number): { gx: number, gy: number } {
    return solveGimbalForTorque(this.engines, centerOfMass, throttle, desiredX, desiredY)
  }

  /** Net thrust with a gimbal command applied to the firing engines. */
  netThrustBodyGimbaled(throttle: number, centerOfMass: Vec3, gx: number, gy: number): ThrustResult {
    return netThrustGimbaled(this.engines, centerOfMass, throttle, gx, gy)
  }

  /**
   * Remove `burnedKg` of propellant, drawn proportionally from the firing
   * stage's tanks that still hold fuel (v1: per-stage draw, no crossfeed).
   * Clamps at empty.
   */
  drain(burnedKg: number): void {
    if (!(burnedKg > 0)) return
    const available = this.stageFuel()
    if (available <= 0) return
    const fraction = Math.min(burnedKg, available) / available
    for (const t of this.firingTanks) {
      const fuel = this.fuel.get(t.instanceId) ?? 0
      if (fuel > 0) this.fuel.set(t.instanceId, Math.max(0, fuel - fuel * fraction))
    }
  }

  /**
   * Per-stage ΔV for the remaining (active) stages, lowest first. Each stage's
   * wet mass is itself + everything above it (payload); its dry mass drops its
   * own propellant. Reflects current fuel, so a partially-burned stage shows its
   * remaining ΔV. v1: stages fire in ascending order, one engine Isp per stage.
   */
  stageSummaries(): StageSummary[] {
    const firingStages = [...new Set(
      this.skeleton.engines.map((e) => e.stage),
    )].sort((a, b) => a - b)

    const partDryMass = (p: PartInstance): number => this.definitions.get(p.defId)?.dryMass ?? 0
    const tankFuel = (instanceId: string): number => this.fuel.get(instanceId) ?? 0
    const active = this.parts.filter((p) => p.active)

    return firingStages.map((stage) => {
      const attached = active.filter((p) => p.stage >= stage)
      const dryStructure = attached.reduce((sum, p) => sum + partDryMass(p), 0)
      const attachedFuel = this.skeleton.tanks
        .filter((t) => t.stage >= stage)
        .reduce((sum, t) => sum + tankFuel(t.instanceId), 0)
      const ownFuel = this.skeleton.tanks
        .filter((t) => t.stage === stage)
        .reduce((sum, t) => sum + tankFuel(t.instanceId), 0)
      const wetMass = dryStructure + attachedFuel
      const dryMass = wetMass - ownFuel
      const isp = this.skeleton.engines.find((e) => e.stage === stage)?.isp ?? 0
      return { stage, wetMass, dryMass, isp, deltaV: deltaVBudget(wetMass, dryMass, isp) }
    })
  }

  /** Total remaining ΔV across all stages. */
  totalDeltaV(): number {
    return this.stageSummaries().reduce((sum, s) => sum + s.deltaV, 0)
  }

  /** True while a later stage exists to advance to. */
  canStage(): boolean {
    return this.parts.some((p) => p.active && p.stage > this.currentStage)
  }

  /**
   * Fire the current stage: jettison its active parts (decouple), advance to the
   * next stage, and rebuild the skeleton + fuel map for the new active set.
   * Returns the jettisoned instance ids for the structural-sync event. A no-op
   * (empty array) when no later stage exists.
   */
  stage(): string[] {
    if (!this.canStage()) return []
    const jettisoned: string[] = []
    for (const part of this.parts) {
      if (part.active && part.stage === this.currentStage) {
        part.active = false
        jettisoned.push(part.instanceId)
      }
    }
    this.currentStage += 1
    this.skeleton = buildSkeleton(this.parts, this.definitions)
    // Keep only fuel for tanks that survived; seed any newly-relevant tanks.
    const survivors = new Map<string, number>()
    for (const tank of this.skeleton.tanks) survivors.set(tank.instanceId, this.fuel.get(tank.instanceId) ?? 0)
    this.fuel = survivors
    return jettisoned
  }
}

function initialFuel(
  parts: PartInstance[],
  definitions: Map<string, PartDefinition>,
  instanceId: string,
): number {
  const part = parts.find((p) => p.instanceId === instanceId)
  if (!part) return 0
  if (typeof part.fuel === 'number') return part.fuel
  // Default a tank to full from its definition's capacity.
  const def = definitions.get(part.defId)
  const tank = def?.modules.find((m) => m.kind === 'tank')
  return tank && tank.kind === 'tank' ? tank.capacity : 0
}
