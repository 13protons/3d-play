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
 * Render-side atmosphere config, loaded as a per-body game asset (e.g.
 * `/data/bodies/<id>/atmosphere.json`) — distinct from the physics
 * `InlineAtmosphere` the sim worker uses for drag. All lengths are in metres
 * (scene units == metres for bodies), so the per-metre scattering coefficients
 * apply directly with no rescale.
 */
export interface AtmosphereRenderConfig {
  /** Atmosphere top above the surface, in metres — radius of the scattering shell. */
  shellHeight: number
  rayleigh: {
    /** Per-metre Rayleigh scattering coefficients, RGB. */
    coefficients: [number, number, number]
    scaleHeight: number
  }
  mie: {
    coefficient: number
    scaleHeight: number
    /** Henyey-Greenstein anisotropy g (forward-scatter sun glow), 0..1. */
    anisotropy: number
  }
  sunIntensity: number
  viewSamples: number
  lightSamples: number
  /**
   * Cheap analytic sky-dome palette for the from-the-ground (vehicle) view — the
   * good-enough stand-in for full scattering. Hex colours; absent on bodies with no
   * walkable sky. Earth is blue day / red dusk; Mars inverts it (butterscotch day,
   * blue dusk); Venus is uniformly ochre. See src/render/sky/VehicleSky.tsx.
   */
  sky?: AtmosphereSkyColors
}

export interface AtmosphereSkyColors {
  /** Overhead day-sky colour. */
  zenith: string
  /** Pale haze colour at the horizon by day. */
  horizon: string
  /** Whitening immediately around the sun disc. */
  sunHalo: string
  /** Bright band toward the sun at low sun (Earth orange; Mars blue). */
  lowSunGlow: string
  /** Deep colour the sky base shifts toward near the horizon toward a low sun. */
  lowSunDeep: string
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

/**
 * Replace an id-keyed map, preserving object identity for entries whose content
 * is unchanged (JSON-equal). Render components memoize materials/geometry on
 * these references — churning identity on every sim restart forces a
 * dispose/rebuild wave across the whole scene, which three's WebGPU backend
 * intermittently mishandles (destroyed buffers left in cached submits → the
 * render pass silently drops every frame).
 */
function stableEntityMap<T extends { id: string }>(
  previous: Record<string, T>,
  next: T[],
): Record<string, T> {
  return Object.fromEntries(
    next.map((entry) => {
      const prev = previous[entry.id]
      const keep = prev && JSON.stringify(prev) === JSON.stringify(entry)
      return [entry.id, keep ? prev : entry]
    }),
  )
}

interface TrajectoriesState {
  curves: Record<string, TrajectoryCurve>
  bodies: Record<string, BodyMeta>
  vehicles: Record<string, VehicleMeta>
  vehicleControls: Record<string, VehicleControlMeta>
  simTime: number
  warpRate: number
  lastUpdateWallTime: number
  /** Mirrors the bridge clock's pause flag so the read-side time stops too. */
  paused: boolean

  updateCurves: (curves: TrajectoryCurve[], simTime: number) => void
  /** Merge curves into the store without touching simTime. Used by vehicle worker. */
  mergeCurves: (curves: TrajectoryCurve[]) => void
  setBodies: (bodies: BodyMeta[]) => void
  setVehicles: (vehicles: VehicleMeta[]) => void
  setVehicleControl: (vehicleId: string, control: VehicleControlMeta) => void
  setWarpRate: (rate: number) => void
  setPaused: (paused: boolean) => void
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
  paused: false,

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
    set((state) => ({
      bodies: stableEntityMap(state.bodies, bodies),
    })),

  setVehicles: (vehicles) =>
    set((state) => ({
      vehicles: stableEntityMap(state.vehicles, vehicles),
    })),

  setVehicleControl: (vehicleId, control) =>
    set((state) => ({
      vehicleControls: { ...state.vehicleControls, [vehicleId]: control },
    })),

  setWarpRate: (rate) => set({ warpRate: rate }),

  // Re-anchor the interpolation clock on resume so the paused wall-time isn't
  // counted as elapsed sim-time (which would make getSimTime jump forward).
  setPaused: (paused) =>
    set(paused ? { paused: true } : { paused: false, lastUpdateWallTime: performance.now() }),

  getSimTime: () => {
    const { simTime, warpRate, lastUpdateWallTime, paused } = get()
    // While paused the bridge isn't advancing the workers, so freeze the
    // read-side clock too — otherwise wall-clock interpolation marches on and
    // consumers extrapolate stale curves (orbit predictions diverge to escape).
    if (paused || warpRate > 100) return simTime
    // At high warp, worker updates carry enough sim-time per tick
    // that interpolation just causes overshoot. Only interpolate at low warp.
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
      paused: false,
    }),
}))
