import { create } from 'zustand'

interface ModeState {
  view: 'menu' | 'flight'
  scenarioId: string | null
  enterFlight: (scenarioId: string) => void
  enterMenu: () => void
}

export const useModeStore = create<ModeState>((set) => ({
  view: 'menu',
  scenarioId: null,
  enterFlight: (scenarioId) => set({ view: 'flight', scenarioId }),
  enterMenu: () => set({ view: 'menu', scenarioId: null }),
}))
