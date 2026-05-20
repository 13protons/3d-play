import { create } from 'zustand'
import type { TrajectoryCurve } from '../sim/types'

export interface VehicleMeta {
  id: string
  name: string
  parentId: string
  mesh: string
}

export interface VehicleControlMeta {
  throttle: number
  orientation: [number, number, number, number]
  angularVelocity: [number, number, number]
  surfaceState: 'flying' | 'landed' | 'crashed'
  aeroForceWorld?: [number, number, number]
}

export interface BodyMeta {
  id: string
  name: string
  parentId: string | null
  mass: number
  gm: number
  radius: number
  axialTilt: number
  angularVelocity: number
  rotationPhase: number
  color: string
  texture?: string
  emissive: boolean
  minimumLight: number
}

interface TrajectoriesState {
  curves: Record<string, TrajectoryCurve>
  bodies: Record<string, BodyMeta>
  vehicles: Record<string, VehicleMeta>
  vehicleControls: Record<string, VehicleControlMeta>
  simTime: number
  warpRate: number
  lastUpdateWallTime: number

  updateCurves: (curves: TrajectoryCurve[], simTime: number) => void
  /** Merge curves into the store without touching simTime. Used by vehicle worker. */
  mergeCurves: (curves: TrajectoryCurve[]) => void
  setBodies: (bodies: BodyMeta[]) => void
  setVehicles: (vehicles: VehicleMeta[]) => void
  setVehicleControl: (vehicleId: string, control: VehicleControlMeta) => void
  setWarpRate: (rate: number) => void
  reset: () => void
  /** Interpolated sim time — use this everywhere for consistent positioning. */
  getSimTime: () => number
}

export const useTrajectoriesStore = create<TrajectoriesState>((set, get) => ({
  curves: {},
  bodies: {},
  vehicles: {},
  vehicleControls: {},
  simTime: 0,
  warpRate: 1,
  lastUpdateWallTime: performance.now(),

  updateCurves: (curves, simTime) =>
    set((state) => {
      const updated = { ...state.curves }
      for (const curve of curves) {
        updated[curve.id] = curve
      }
      return { curves: updated, simTime, lastUpdateWallTime: performance.now() }
    }),

  mergeCurves: (curves) =>
    set((state) => {
      const updated = { ...state.curves }
      for (const curve of curves) {
        updated[curve.id] = curve
      }
      return { curves: updated }
    }),

  setBodies: (bodies) =>
    set({
      bodies: Object.fromEntries(bodies.map((b) => [b.id, b])),
    }),

  setVehicles: (vehicles) =>
    set({
      vehicles: Object.fromEntries(vehicles.map((v) => [v.id, v])),
    }),

  setVehicleControl: (vehicleId, control) =>
    set((state) => ({
      vehicleControls: { ...state.vehicleControls, [vehicleId]: control },
    })),

  setWarpRate: (rate) => set({ warpRate: rate }),

  getSimTime: () => {
    const { simTime, warpRate, lastUpdateWallTime } = get()
    // At high warp, worker updates carry enough sim-time per tick
    // that interpolation just causes overshoot. Only interpolate at low warp.
    if (warpRate > 100) return simTime
    const wallDelta = (performance.now() - lastUpdateWallTime) / 1000
    return simTime + wallDelta * warpRate
  },

  reset: () =>
    set({
      curves: {},
      bodies: {},
      vehicles: {},
      vehicleControls: {},
      simTime: 0,
      warpRate: 1,
      lastUpdateWallTime: performance.now(),
    }),
}))
