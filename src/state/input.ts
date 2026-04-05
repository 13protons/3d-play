import { create } from 'zustand'
import type { Command } from '../sim/types'

interface InputState {
  commands: Command[]
  push: (cmd: Command) => void
  drain: () => Command[]
}

export const useInputStore = create<InputState>((set) => ({
  commands: [],
  push: (cmd) => set((state) => ({ commands: [...state.commands, cmd] })),
  drain: () => {
    let drained: Command[] = []
    set((state) => {
      drained = state.commands
      return { commands: [] }
    })
    return drained
  },
}))
