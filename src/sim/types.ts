// ---------------------------------------------------------------------------
// Coordinate System
// ---------------------------------------------------------------------------

/** Integer sector grid + float64 local offset. See notes/02-coordinate-system.md */
export interface SectorPosition {
  sector: [ix: number, iy: number, iz: number] // integers
  local: [x: number, y: number, z: number] // 0 ≤ val < SECTOR_SIZE
}

// ---------------------------------------------------------------------------
// Trajectory Curves
// ---------------------------------------------------------------------------

/** Cubic Hermite spline segment. See notes/05-physics-workers.md */
export interface TrajectoryCurve {
  id: string
  parentId: string // curve is relative to this body
  p0: [number, number, number] // position at t0 (parent-relative)
  v0: [number, number, number] // velocity at t0
  t0: number // sim-time start
  p1: [number, number, number] // position at t1
  v1: [number, number, number] // velocity at t1
  t1: number // sim-time end
}

// ---------------------------------------------------------------------------
// Environment Patches
// ---------------------------------------------------------------------------

/** Local field approximation sent from orbital → vehicle worker. See notes/06-environment-patches.md */
export interface EnvironmentPatch {
  center: SectorPosition
  radius: number
  bodyId: string
  t0: number
  t1: number

  atmosphere?: {
    density: number
    densityGradient: [number, number, number]
    temperature: number
    temperatureGradient: [number, number, number]
    pressure: number
    windVelocity: [number, number, number]
  }

  terrain?: {
    gridOrigin: [number, number]
    gridSize: number
    gridResolution: number
    heights: Float32Array
    normals?: Float32Array
  }

  gravity?: {
    acceleration: [number, number, number]
    tidal: [
      number, number, number,
      number, number, number,
      number, number, number,
    ]
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Commands routed to the player vehicle worker */
export type VehicleCommand =
  | { type: 'set-throttle'; value: number; simTime: number }
  | { type: 'set-attitude'; pitch: number; yaw: number; roll: number; simTime: number }
  | { type: 'stage'; simTime: number }

/** Commands routed to the orbital worker */
export type SimCommand =
  | { type: 'set-warp'; rate: number; simTime: number }

export type Command = VehicleCommand | SimCommand

// ---------------------------------------------------------------------------
// Celestial Bodies (runtime state in the orbital worker)
// ---------------------------------------------------------------------------

export interface CelestialBody {
  id: string
  name: string
  parentId: string | null

  mass: number
  radius: number
  soiRadius?: number

  position: SectorPosition
  velocity: [number, number, number]

  orientation: [number, number, number, number] // quaternion
  angularVelocity: number // rad/s (scalar, spins around own axis)

  atmosphereModel?: string
}

// ---------------------------------------------------------------------------
// Vessels
// ---------------------------------------------------------------------------

export interface PartInstance {
  instanceId: string
  defId: string
  parentInstanceId: string | null
  parentAttachPointId: string | null
  myAttachPointId: string
  localPosition: [number, number, number]
  localRotation: [number, number, number, number]

  fuel?: number
  temperature?: number
  stage: number
  active: boolean
}

export interface VesselPhysics {
  id: string
  parts: PartInstance[]
  position: SectorPosition
  velocity: [number, number, number]
  orientation: [number, number, number, number]
  angularVelocity: [number, number, number]
  currentStage: number
}

// ---------------------------------------------------------------------------
// Worker Messages
// ---------------------------------------------------------------------------

export type OrbitalInbound =
  | { type: 'commands'; commands: SimCommand[] }
  | { type: 'vehicle-positions'; vehicles: { id: string; position: SectorPosition }[] }

export type VehicleInbound =
  | { type: 'commands'; commands: VehicleCommand[] }
  | { type: 'environment-patch'; patch: EnvironmentPatch }

export type WorkerOutbound =
  | { type: 'trajectories'; simTime: number; curves: TrajectoryCurve[] }
  | { type: 'active'; simTime: number; entities: Float64Array }
  | { type: 'event'; event: SimEvent }
  | { type: 'environment-patch'; patch: EnvironmentPatch }
  | { type: 'vehicle-position'; id: string; position: SectorPosition }

export interface SimEvent {
  kind: string
  simTime: number
  entityId: string
  data?: Record<string, unknown>
}
