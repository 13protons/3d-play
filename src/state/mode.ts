import { create } from 'zustand'

interface ModeState {
  view: 'menu' | 'flight'
  scenarioId: string | null
  activeView: 'orbital' | 'vehicle'
  showRotationAxes: boolean
  showAttitudeDiagnostics: boolean
  perfLogging: boolean
  showKeyboardShortcuts: boolean
  enterFlight: (scenarioId: string) => void
  enterMenu: () => void
  setActiveView: (view: 'orbital' | 'vehicle') => void
  toggleView: () => void
  toggleRotationAxes: () => void
  toggleAttitudeDiagnostics: () => void
  togglePerfLogging: () => void
  toggleKeyboardShortcuts: () => void
}

export const useModeStore = create<ModeState>((set) => ({
  view: 'menu',
  scenarioId: null,
  activeView: 'orbital',
  showRotationAxes: false,
  showAttitudeDiagnostics: false,
  perfLogging: false,
  showKeyboardShortcuts: false,
  enterFlight: (scenarioId) => set({ view: 'flight', scenarioId, activeView: 'orbital' }),
  enterMenu: () => set({ view: 'menu', scenarioId: null, activeView: 'orbital', showRotationAxes: false }),
  setActiveView: (activeView) => set({ activeView }),
  toggleView: () => set((state) => ({ activeView: state.activeView === 'orbital' ? 'vehicle' : 'orbital' })),
  toggleRotationAxes: () => set((state) => ({ showRotationAxes: !state.showRotationAxes })),
  toggleAttitudeDiagnostics: () => set((state) => ({ showAttitudeDiagnostics: !state.showAttitudeDiagnostics })),
  togglePerfLogging: () => set((state) => ({ perfLogging: !state.perfLogging })),
  toggleKeyboardShortcuts: () =>
    set((state) => ({ showKeyboardShortcuts: !state.showKeyboardShortcuts })),
}))
