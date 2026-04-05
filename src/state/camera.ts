import { create } from 'zustand'

interface CameraState {
  followTargetId: string
  setFollowTarget: (id: string) => void
}

export const useCameraStore = create<CameraState>((set) => ({
  followTargetId: 'earth',
  setFollowTarget: (id) => set({ followTargetId: id }),
}))
