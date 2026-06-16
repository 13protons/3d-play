import { create } from 'zustand'

interface ModeState {
  view: 'menu' | 'flight'
  scenarioId: string | null
  activeView: 'orbital' | 'vehicle'
  showRotationAxes: boolean
  showAttitudeDiagnostics: boolean
  enterFlight: (scenarioId: string) => void
  enterMenu: () => void
  setActiveView: (view: 'orbital' | 'vehicle') => void
  toggleView: () => void
  toggleRotationAxes: () => void
  toggleAttitudeDiagnostics: () => void
}

export const useModeStore = create<ModeState>((set) => ({
  view: 'menu',
  scenarioId: null,
  activeView: 'orbital',
  showRotationAxes: false,
  showAttitudeDiagnostics: false,
  enterFlight: (scenarioId) => set({ view: 'flight', scenarioId, activeView: 'orbital' }),
  enterMenu: () => set({ view: 'menu', scenarioId: null, activeView: 'orbital', showRotationAxes: false }),
  setActiveView: (activeView) => set({ activeView }),
  toggleView: () => set((state) => ({ activeView: state.activeView === 'orbital' ? 'vehicle' : 'orbital' })),
  toggleRotationAxes: () => set((state) => ({ showRotationAxes: !state.showRotationAxes })),
  toggleAttitudeDiagnostics: () => set((state) => ({ showAttitudeDiagnostics: !state.showAttitudeDiagnostics })),
}))
