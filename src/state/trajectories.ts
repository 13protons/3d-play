import { create } from 'zustand'
import type { AttitudeTarget, StageSummary, TrajectoryCurve } from '../sim/types'

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
  attitudeTargetKind: AttitudeTarget['kind']
  surfaceState: 'flying' | 'landed' | 'crashed'
  reactionWheelTorque?: [number, number, number]
  commandedTorque?: [number, number, number]
  mass?: number
  fuelMass?: number
  maxThrust?: number
  isp?: number
  currentThrust?: number
  aeroForceWorld?: [number, number, number]
  currentStage?: number
  canStage?: boolean
  stages?: StageSummary[]
  centerOfMass?: [number, number, number]
  thrustBody?: [number, number, number]
  torqueBody?: [number, number, number]
  pressureRatio?: number
  centerOfPressure?: [number, number, number]
}

/**
 * Render-side atmosphere config — the `render` section of a body's
 * `/data/bodies/<id>/atmosphere.json` asset. Serialized in takram/Bruneton's own
 * units (per-km scattering coefficients, metre scale heights) so it maps
 * field-for-field onto `AtmosphereParameters` with no conversion. The body radius
 * (`bottomRadius`) is NOT here — it comes from the manifest's `physics.radius`;
 * `topRadius = radius + shellHeight`. The `physics` section of the same asset
 * (exponential drag model) is consumed separately by the sim worker.
 */
export interface AtmosphereRenderConfig {
  /** Scattering shell thickness above the surface, m. topRadius = radius + shellHeight. */
  shellHeight: number
  /** Rayleigh scattering coefficients (per-km, takram units), RGB. */
  rayleighScattering: [number, number, number]
  /** Rayleigh density scale height, m. */
  rayleighScaleHeight: number
  /** Mie scattering coefficient (per-km, grey — expanded to RGB by the mapper). */
  mieScattering: number
  /** Mie density scale height, m. */
  mieScaleHeight: number
  /** Henyey-Greenstein anisotropy g (forward-scatter sun glow), 0..1. */
  miePhaseFunctionG: number
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
  /** Present only for bodies whose plugin bundle links an atmosphere asset. */
  atmosphereRender?: AtmosphereRenderConfig
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
