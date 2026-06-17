import { create } from 'zustand'
import type { ManeuverDeltaV, ManeuverNode } from '../sim/maneuverNode'

interface ManeuverState {
  /** One pending maneuver node per vessel. */
  nodes: Record<string, ManeuverNode>
  setNode: (node: ManeuverNode) => void
  updateDeltaV: (vesselId: string, deltaV: Partial<ManeuverDeltaV>) => void
  clearNode: (vesselId: string) => void
}

export const useManeuverStore = create<ManeuverState>((set) => ({
  nodes: {},
  setNode: (node) =>
    set((state) => ({ nodes: { ...state.nodes, [node.vesselId]: node } })),
  updateDeltaV: (vesselId, deltaV) =>
    set((state) => {
      const existing = state.nodes[vesselId]
      if (!existing) return state
      return {
        nodes: {
          ...state.nodes,
          [vesselId]: { ...existing, deltaV: { ...existing.deltaV, ...deltaV } },
        },
      }
    }),
  clearNode: (vesselId) =>
    set((state) => {
      if (!state.nodes[vesselId]) return state
      const next = { ...state.nodes }
      delete next[vesselId]
      return { nodes: next }
    }),
}))
