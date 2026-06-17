import { create } from 'zustand'
import type { OrbitalElements } from '../sim/orbital/kepler'

export interface OrbitPredictionSnapshot {
  elements: OrbitalElements
  /** Sim time at which `elements` were captured. */
  simTime: number
}

interface OrbitPredictionState {
  /** Per-vehicle snapshot, written by VehicleOrbitPrediction whenever it recomputes. */
  snapshots: Record<string, OrbitPredictionSnapshot>
  setSnapshot: (vehicleId: string, snapshot: OrbitPredictionSnapshot) => void
  clearSnapshot: (vehicleId: string) => void
}

export const useOrbitPredictionStore = create<OrbitPredictionState>((set) => ({
  snapshots: {},
  setSnapshot: (vehicleId, snapshot) =>
    set((state) => ({ snapshots: { ...state.snapshots, [vehicleId]: snapshot } })),
  clearSnapshot: (vehicleId) =>
    set((state) => {
      if (!state.snapshots[vehicleId]) return state
      const next = { ...state.snapshots }
      delete next[vehicleId]
      return { snapshots: next }
    }),
}))
