/**
 * Vehicle state store.
 *
 * Part-level state (fuel, temperatures, stress) for HUD display.
 * Updated by the bridge when vehicle workers send part state messages.
 */

import { create } from 'zustand'
import type { PartInstance } from '../sim/types'
import type { PartDefinition } from '../sim/vehicle/parts'

export interface VehicleResourcesInput {
  dryMass: number
  fuelMass: number
}

export interface VehicleResources extends VehicleResourcesInput {
  mass: number
}

export interface VehicleAero {
  model: 'simple-drag'
  dragCoefficient: number
  referenceArea: number
  referenceLength?: number
  centerOfPressureBody?: [number, number, number]
}

export interface VehicleEngine {
  maxThrust: number
  /** Specific impulse (s) — sets propellant flow via ṁ = F/(Isp·g₀). */
  isp: number
}

export interface VehicleAttitude {
  momentOfInertia: [number, number, number]
  reactionWheelTorque: [number, number, number]
}

export interface VehicleModelInput {
  resources: VehicleResourcesInput
  engine?: VehicleEngine
  attitude?: VehicleAttitude
  aero?: VehicleAero
  /** Optional multi-part tree (authored in the scenario). */
  parts?: PartInstance[]
  partDefs?: [id: string, def: PartDefinition][]
}

export interface VehicleModel {
  resources: VehicleResources
  engine?: VehicleEngine
  attitude?: VehicleAttitude
  aero?: VehicleAero
  /**
   * The render mirror of the part tree. The worker owns the authoritative copy;
   * structural-sync events (staging) flip `active` here to keep them in lockstep
   * without re-shipping the tree. Undefined for single-body craft.
   */
  parts?: PartInstance[]
  partDefs?: [id: string, def: PartDefinition][]
}

interface VehicleState {
  models: Record<string, VehicleModel>
  setVehicleModel: (vehicleId: string, model: VehicleModelInput) => void
  /** Structural-sync: deactivate jettisoned parts in the render mirror. */
  applyStaging: (vehicleId: string, jettisoned: string[]) => void
  reset: () => void
}

export const useVehicleStore = create<VehicleState>((set) => ({
  models: {},

  setVehicleModel: (vehicleId, model) => set((state) => ({
    models: {
      ...state.models,
      [vehicleId]: {
        resources: {
          ...model.resources,
          mass: model.resources.dryMass + model.resources.fuelMass,
        },
        engine: model.engine,
        attitude: model.attitude,
        aero: model.aero,
        parts: model.parts,
        partDefs: model.partDefs,
      },
    },
  })),

  applyStaging: (vehicleId, jettisoned) => set((state) => {
    const model = state.models[vehicleId]
    if (!model?.parts || jettisoned.length === 0) return state
    const dropped = new Set(jettisoned)
    return {
      models: {
        ...state.models,
        [vehicleId]: {
          ...model,
          parts: model.parts.map((p) => (dropped.has(p.instanceId) ? { ...p, active: false } : p)),
        },
      },
    }
  }),

  reset: () => set({ models: {} }),
}))
