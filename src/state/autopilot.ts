/**
 * Autopilot store.
 *
 * Per-vehicle autopilot mode. The bridge consumes this each tick, evaluates
 * computeAttitudeTarget(mode, ...), and posts set-attitude-target to the
 * vehicle worker. Future autopilots (maneuver, ascent, landing) will live
 * on the same mode enum or as a separate field on the same per-vehicle entry.
 */

import { create } from 'zustand'
import type { AutopilotMode } from '../sim/autopilot'

interface AutopilotState {
  modes: Record<string, AutopilotMode>
  setMode: (vehicleId: string, mode: AutopilotMode) => void
  /** Toggle: selecting the active mode again returns to off. */
  toggleMode: (vehicleId: string, mode: AutopilotMode) => void
  reset: () => void
}

export const useAutopilotStore = create<AutopilotState>((set) => ({
  modes: {},

  setMode: (vehicleId, mode) =>
    set((state) => ({ modes: { ...state.modes, [vehicleId]: mode } })),

  toggleMode: (vehicleId, mode) =>
    set((state) => {
      const current = state.modes[vehicleId] ?? 'off'
      const next = current === mode ? 'off' : mode
      return { modes: { ...state.modes, [vehicleId]: next } }
    }),

  reset: () => set({ modes: {} }),
}))
