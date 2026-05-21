/**
 * Vehicle state store.
 *
 * Part-level state (fuel, temperatures, stress) for HUD display.
 * Updated by the bridge when vehicle workers send part state messages.
 */

import { create } from 'zustand'

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
}

export interface VehicleModel {
  resources: VehicleResources
  engine?: VehicleEngine
  attitude?: VehicleAttitude
  aero?: VehicleAero
}

interface VehicleState {
  models: Record<string, VehicleModel>
  setVehicleModel: (vehicleId: string, model: VehicleModelInput) => void
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
      },
    },
  })),

  reset: () => set({ models: {} }),
}))
