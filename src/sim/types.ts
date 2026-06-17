import type { PartDefinition } from './vehicle/parts'

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
// Commands
// ---------------------------------------------------------------------------

/** Commands routed to the player vehicle worker */
export type VehicleCommand =
  | { type: 'set-throttle'; value: number; simTime: number }
  | { type: 'set-attitude'; pitch: number; yaw: number; roll: number; simTime: number }
  | { type: 'set-attitude-target'; target: AttitudeTarget; simTime: number }
  | { type: 'stage'; simTime: number }

/** Commands routed to the orbital worker */
export type SimCommand =
  | { type: 'set-warp'; rate: number; simTime: number }

export type Command = VehicleCommand | SimCommand

/**
 * Vehicle-worker-level attitude target. Autopilots emit this; the worker
 * tracks whatever is requested without knowing which autopilot produced it.
 */
export type AttitudeTarget =
  | { kind: 'manual' }
  | { kind: 'damp' }
  | { kind: 'seek-forward'; vector: [number, number, number] }

// ---------------------------------------------------------------------------
// Gravity Sources (sent from bridge to vehicle worker)
// ---------------------------------------------------------------------------

export interface GravitySource {
  gm: number // G * mass
  position: [number, number, number] // absolute position at reference time
  velocity: [number, number, number] // absolute velocity for prediction
}

export interface InlineAtmosphere {
  loadRadiusMultiplier: number
  model: 'exponential'
  surfaceDensity: number
  scaleHeight: number
  maxAltitude: number
}

export interface VehicleResources {
  dryMass: number
  fuelMass: number
  mass: number
}

export interface VehicleAero {
  model: 'simple-drag'
  dragCoefficient: number
  referenceArea: number
  referenceLength?: number
  centerOfPressureBody?: [number, number, number]
}

export interface VehicleEngine {
  maxThrust: number
  /** Specific impulse (s) — sets propellant flow via ṁ = F/(Isp·g₀). */
  isp: number
}

export interface VehicleAttitude {
  momentOfInertia: [number, number, number]
  reactionWheelTorque: [number, number, number]
}

/** Per-stage ΔV readout (upper stages count as payload for the lower ones). */
export interface StageSummary {
  stage: number
  /** Mass at this stage's ignition (this stage + everything above it). */
  wetMass: number
  /** Mass at this stage's burnout (wet minus this stage's own propellant). */
  dryMass: number
  isp: number
  deltaV: number
}

// ---------------------------------------------------------------------------
// Vehicle Worker Messages
// ---------------------------------------------------------------------------

/** Inbound messages to the vehicle worker */
export type VehicleWorkerInbound =
  | {
      type: 'init'
      vehicle: {
        id: string
        parentId: string
        position: SectorPosition
        velocity: [number, number, number]
      }
      bodyCurves: TrajectoryCurve[]
      bodyGMs: [string, number][]  // [id, G*M] pairs (Map not transferable)
      bodySurfaces: [id: string, radius: number, angularVelocity: number, axialTilt: number, atmosphere?: InlineAtmosphere][]
      resources?: VehicleResources
      engine?: VehicleEngine
      attitude?: VehicleAttitude
      aero?: VehicleAero
      /**
       * Optional multi-part tree (authored outside the worker). When present the
       * worker derives mass / CoM / inertia / thrust from it; otherwise it
       * synthesizes a degenerate 1-part structure from resources/engine/attitude.
       */
      parts?: PartInstance[]
      partDefs?: [id: string, def: PartDefinition][]
    }
  | {
      type: 'advance'
      targetTime: number
      bodyCurves: TrajectoryCurve[]
    }
  | { type: 'set-warp'; rate: number }
  | { type: 'set-throttle'; value: number }
  | { type: 'set-attitude'; pitch: number; yaw: number; roll: number }
  | { type: 'set-attitude-target'; target: AttitudeTarget }
  | { type: 'stage' }

/** Outbound messages from the vehicle worker */
export type VehicleWorkerOutbound =
  | {
      type: 'vehicle-trajectories'
      simTime: number
      curves: TrajectoryCurve[]
    }
  | {
      type: 'vehicle-position'
      position: [number, number, number]
      velocity: [number, number, number]
    }
  | {
      /**
       * Structural-sync event: a staging (or later, damage) change resolved in
       * the worker. The outside render mirror deactivates these parts so both
       * copies stay in lockstep without re-shipping the whole tree.
       */
      type: 'vehicle-structure'
      id: string
      jettisoned: string[]
      currentStage: number
    }
  | {
      type: 'vehicle-controls'
      id: string
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
    }

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
  | {
      type: 'init'
      bodies: {
        id: string; name: string; parentId: string | null
        mass: number; gm: number; radius: number; soiRadius?: number
        position: SectorPosition; velocity: [number, number, number]
      }[]
    }
  | { type: 'advance'; targetTime: number }
  | { type: 'set-warp'; rate: number }

export type WorkerOutbound =
  | { type: 'trajectories'; simTime: number; curves: TrajectoryCurve[] }
  | { type: 'active'; simTime: number; entities: Float64Array }
  | { type: 'event'; event: SimEvent }
  | { type: 'vehicle-position'; id: string; position: SectorPosition }
  | {
      type: 'cube-patch-response'
      gravityVectors: [number, number, number][] // 6 gravity vectors at requested points
    }

export interface SimEvent {
  kind: string
  simTime: number
  entityId: string
  data?: Record<string, unknown>
}
