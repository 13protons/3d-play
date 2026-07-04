/**
 * Scene-editor authoring model + resolver.
 *
 * A `SceneDraft` is the editable, *intent-preserving* representation: it stores
 * the base body set (cloned from a built-in scenario), a parent orbital-phase
 * scrub, and the vehicle's placement as either Keplerian elements or a
 * surface pin. `resolveScene` turns a draft into the runtime scenario shape the
 * worker bridge consumes (absolute SectorPosition + velocity). The draft is the
 * source of truth on disk so a scene reopens losslessly; the resolved scenario
 * is a derived, throwaway artifact handed to `startSim`.
 *
 * Pure module — no React, no fetch. The caller supplies body metadata
 * (`BodyResolveMeta`) loaded from the body manifests.
 */

import type {
  SectorPosition,
  VehicleAero,
  VehicleAttitude,
  VehicleEngine,
} from '../sim/types'

type Vec3 = [number, number, number]
import { toAbsolute } from '../sim/coordinates'
import { vectorToSectorPosition } from '../sim/ephemeris'
import { stateToElements, stateToElementVector, elementsToState } from '../sim/orbital/kepler'
import { rotationAxisFromAxialTilt, surfaceFrame } from '../sim/vehicle/referenceFrame'

export interface SceneBodyState {
  position: SectorPosition
  velocity: Vec3
  /** Spin phase at epoch (radians) — render-side; sets day/night + launch-site facing. */
  rotationPhase: number
}

/** Vehicle starting placement, expressed as authoring intent. */
export type VehiclePlacement =
  | {
      mode: 'orbital'
      /** Parent-relative Keplerian elements. Angles in radians. */
      a: number
      e: number
      i: number
      lan: number
      aop: number
      ta: number
    }
  | {
      mode: 'surface'
      /** Geodetic-ish latitude/longitude (radians) in the body-fixed frame. */
      lat: number
      lon: number
      /** Meters above the mean surface (radius). */
      altitude: number
      /**
       * Velocity relative to the rotating surface, in the local tangent frame
       * [east, north, up] (m/s). Co-rotation is added on top automatically, so
       * [0,0,0] = sitting still on the ground.
       */
      surfaceVelocity: Vec3
    }

export interface SceneVehicle {
  id: string
  name: string
  parentId: string
  placement: VehiclePlacement
  mesh?: string
  // Physics config is carried through verbatim — this editor is placement-only.
  resources?: { dryMass: number; fuelMass: number }
  engine?: VehicleEngine
  attitude?: VehicleAttitude
  aero?: VehicleAero
}

export interface SceneDraft {
  /** Stable storage key. */
  id: string
  name: string
  epoch: number
  /** Which built-in scenario the body set was cloned from (provenance). */
  baseScenarioId: string
  /** Base (unscrubbed) body states, keyed by body id. */
  bodies: Record<string, SceneBodyState>
  /** Advance the vehicle's parent body along its own orbit by this true-anomaly delta (radians). */
  parentScrub: { deltaTrueAnomaly: number }
  vehicle: SceneVehicle
}

/** Per-body metadata needed to resolve a draft, loaded from body manifests. */
export interface BodyResolveMeta {
  parentId: string | null
  gm: number
  radius: number
  axialTilt: number
  angularVelocity: number
}

/** Runtime scenario shape consumed by `startSim` / the worker bridge. */
export interface RuntimeScenario {
  id: string
  name: string
  epoch: number
  bodies: Record<string, { position: SectorPosition; velocity: Vec3; rotationPhase: number }>
  vehicles: Array<Record<string, unknown>>
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

/** Bodies whose parent chain passes through `rootId` (excludes the root itself). */
export function descendantsOf(
  rootId: string,
  meta: Record<string, BodyResolveMeta>,
): string[] {
  const result: string[] = []
  for (const id of Object.keys(meta)) {
    if (id === rootId) continue
    let cursor: string | null = meta[id].parentId
    while (cursor) {
      if (cursor === rootId) {
        result.push(id)
        break
      }
      cursor = meta[cursor]?.parentId ?? null
    }
  }
  return result
}

/**
 * Resolve a vehicle's parent-relative position/velocity for a surface pin.
 * The longitude reference is arbitrary (a fixed equatorial basis derived from
 * the spin axis); this is a debug authoring tool, so absolute longitude is only
 * meaningful relative to `rotationPhase`.
 */
export function surfacePlacementToRelativeState(params: {
  lat: number
  lon: number
  altitude: number
  radius: number
  axialTilt: number
  angularVelocity: number
  rotationPhase: number
  surfaceVelocity: Vec3
}): { position: Vec3; velocity: Vec3 } {
  const { lat, lon, altitude, radius, axialTilt, angularVelocity, rotationPhase, surfaceVelocity } =
    params
  const axis = rotationAxisFromAxialTilt(axialTilt)
  // A stable equatorial basis perpendicular to the spin axis.
  let eRef = cross(axis, [0, 0, 1])
  if (Math.hypot(...eRef) < 1e-6) eRef = cross(axis, [1, 0, 0])
  const eMag = Math.hypot(...eRef)
  eRef = scale(eRef, 1 / eMag)
  const eRef90 = cross(axis, eRef) // already unit (axis ⟂ eRef, both unit)

  // Body rotation about its axis carries longitude forward by rotationPhase.
  const lonWorld = lon + rotationPhase
  const cosLat = Math.cos(lat)
  const dir: Vec3 = [
    cosLat * (Math.cos(lonWorld) * eRef[0] + Math.sin(lonWorld) * eRef90[0]) + Math.sin(lat) * axis[0],
    cosLat * (Math.cos(lonWorld) * eRef[1] + Math.sin(lonWorld) * eRef90[1]) + Math.sin(lat) * axis[1],
    cosLat * (Math.cos(lonWorld) * eRef[2] + Math.sin(lonWorld) * eRef90[2]) + Math.sin(lat) * axis[2],
  ]
  const position = scale(dir, radius + altitude)

  // Co-rotation velocity: ω × r.
  const corotation = scale(cross(axis, position), angularVelocity)

  // Surface-relative velocity in the local [east, north, up] tangent frame.
  const frame = surfaceFrame(position, axis)
  let surfaceWorld: Vec3 = [0, 0, 0]
  if (frame) {
    surfaceWorld = add(
      add(scale(frame.east, surfaceVelocity[0]), scale(frame.north, surfaceVelocity[1])),
      scale(frame.up, surfaceVelocity[2]),
    )
  }

  return { position, velocity: add(corotation, surfaceWorld) }
}

/**
 * Build an editable draft from a runtime scenario (e.g. a built-in scenario
 * cloned as a starting point). The first vehicle's absolute state is converted
 * back into parent-relative Keplerian elements so it reopens as orbital
 * authoring. Only default-frame scenarios are supported — callers should not
 * pass `jpl-ecliptic` scenarios, whose stored axes don't match the sim's y-up
 * convention.
 */
export function buildDraftFromScenario(
  scenario: {
    bodies: Record<string, { position: SectorPosition; velocity: Vec3; rotationPhase?: number }>
    vehicles?: Array<Record<string, unknown>>
  },
  meta: Record<string, BodyResolveMeta>,
  identity: { id: string; name: string; baseScenarioId: string; epoch?: number },
): SceneDraft {
  const bodies: Record<string, SceneBodyState> = {}
  for (const [id, b] of Object.entries(scenario.bodies)) {
    bodies[id] = {
      position: { sector: [...b.position.sector], local: [...b.position.local] },
      velocity: [...b.velocity],
      rotationPhase: b.rotationPhase ?? 0,
    }
  }

  const raw = (scenario.vehicles ?? [])[0] as
    | {
        id?: string
        name?: string
        parentId?: string
        position?: SectorPosition
        velocity?: Vec3
        mesh?: string
        resources?: { dryMass: number; fuelMass: number }
        engine?: VehicleEngine
        attitude?: VehicleAttitude
        aero?: VehicleAero
      }
    | undefined

  // Default placement: a low circular orbit around the first non-root body.
  const fallbackParent =
    Object.keys(bodies).find((id) => meta[id]?.parentId) ?? Object.keys(bodies)[0] ?? 'earth'
  let placement: VehiclePlacement = {
    mode: 'orbital',
    a: (meta[fallbackParent]?.radius ?? 1_000_000) * 1.2,
    e: 0,
    i: 0,
    lan: 0,
    aop: 0,
    ta: 0,
  }
  let parentId = raw?.parentId ?? fallbackParent

  if (raw?.position && raw.velocity && raw.parentId && bodies[raw.parentId] && meta[raw.parentId]) {
    parentId = raw.parentId
    const parent = bodies[parentId]
    const relR = sub(toAbsolute(raw.position), toAbsolute(parent.position))
    const relV = sub(raw.velocity, parent.velocity)
    // Lossless inverse (pairs with elementsToState). Null for non-orbital
    // states (radial / at-rest on the surface) — fall back to a low circular
    // orbit at the same radius so the editor opens on a sane, editable orbit.
    const el = stateToElementVector(relR, relV, meta[parentId].gm)
    if (el && Number.isFinite(el.a) && el.a > 0 && el.e < 1) {
      placement = { mode: 'orbital', a: el.a, e: el.e, i: el.i, lan: el.lan, aop: el.aop, ta: el.ta }
    } else {
      const radius = Math.max(Math.hypot(...relR), meta[parentId].radius * 1.05)
      placement = { mode: 'orbital', a: radius, e: 0, i: 0, lan: 0, aop: 0, ta: 0 }
    }
  }

  return {
    id: identity.id,
    name: identity.name,
    epoch: identity.epoch ?? 0,
    baseScenarioId: identity.baseScenarioId,
    bodies,
    parentScrub: { deltaTrueAnomaly: 0 },
    vehicle: {
      id: raw?.id ?? 'vehicle-1',
      name: raw?.name ?? 'Vehicle',
      parentId,
      placement,
      mesh: raw?.mesh,
      resources: raw?.resources,
      engine: raw?.engine,
      attitude: raw?.attitude,
      aero: raw?.aero,
    },
  }
}

/** Turn an authoring draft into the runtime scenario the bridge consumes. */
export function resolveScene(
  draft: SceneDraft,
  meta: Record<string, BodyResolveMeta>,
): RuntimeScenario {
  // Work on a mutable copy of the base body states.
  const bodies: Record<string, SceneBodyState> = {}
  for (const [id, body] of Object.entries(draft.bodies)) {
    bodies[id] = {
      position: { sector: [...body.position.sector], local: [...body.position.local] },
      velocity: [...body.velocity],
      rotationPhase: body.rotationPhase,
    }
  }

  const parentId = draft.vehicle.parentId
  const parentMeta = meta[parentId]

  // 1. Parent orbital-phase scrub — advance the parent along its own orbit and
  //    rigidly co-translate its satellites so relative configuration is kept.
  const delta = draft.parentScrub.deltaTrueAnomaly
  const grandParentId = parentMeta?.parentId ?? null
  if (delta !== 0 && grandParentId && meta[grandParentId] && bodies[grandParentId] && bodies[parentId]) {
    const gp = bodies[grandParentId]
    const gpAbs = toAbsolute(gp.position)
    const parentAbs = toAbsolute(bodies[parentId].position)
    const relR = sub(parentAbs, gpAbs)
    const relV = sub(bodies[parentId].velocity, gp.velocity)
    const el = stateToElements(relR, relV, meta[grandParentId].gm)
    const moved = elementsToState({ a: el.a, e: el.e, i: el.i, lan: el.lan, aop: el.aop, ta: el.ta + delta, mu: el.mu })
    const newParentAbs = add(gpAbs, moved.position)
    const newParentVel = add(gp.velocity, moved.velocity)
    const dPos = sub(newParentAbs, parentAbs)
    const dVel = sub(newParentVel, bodies[parentId].velocity)
    for (const id of [parentId, ...descendantsOf(parentId, meta)]) {
      if (!bodies[id]) continue
      const abs = add(toAbsolute(bodies[id].position), dPos)
      bodies[id] = {
        ...bodies[id],
        position: vectorToSectorPosition(abs),
        velocity: add(bodies[id].velocity, dVel),
      }
    }
  }

  // 2. Resolve the vehicle relative to the (possibly scrubbed) parent.
  const parentState = bodies[parentId]
  const parentAbs = parentState ? toAbsolute(parentState.position) : [0, 0, 0] as Vec3
  const parentVel = parentState ? parentState.velocity : [0, 0, 0] as Vec3
  const placement = draft.vehicle.placement

  let relPos: Vec3
  let relVel: Vec3
  if (placement.mode === 'orbital') {
    const state = elementsToState({
      a: placement.a,
      e: placement.e,
      i: placement.i,
      lan: placement.lan,
      aop: placement.aop,
      ta: placement.ta,
      mu: parentMeta?.gm ?? 0,
    })
    relPos = state.position
    relVel = state.velocity
  } else {
    const surface = surfacePlacementToRelativeState({
      lat: placement.lat,
      lon: placement.lon,
      altitude: placement.altitude,
      radius: parentMeta?.radius ?? 0,
      axialTilt: parentMeta?.axialTilt ?? 0,
      angularVelocity: parentMeta?.angularVelocity ?? 0,
      rotationPhase: parentState?.rotationPhase ?? 0,
      surfaceVelocity: placement.surfaceVelocity,
    })
    relPos = surface.position
    relVel = surface.velocity
  }

  const vehicleAbs = add(parentAbs, relPos)
  const vehicleVel = add(parentVel, relVel)

  const vehicle: Record<string, unknown> = {
    id: draft.vehicle.id,
    name: draft.vehicle.name,
    parentId,
    position: vectorToSectorPosition(vehicleAbs),
    velocity: vehicleVel,
  }
  if (draft.vehicle.mesh) vehicle.mesh = draft.vehicle.mesh
  if (draft.vehicle.resources) vehicle.resources = draft.vehicle.resources
  if (draft.vehicle.engine) vehicle.engine = draft.vehicle.engine
  if (draft.vehicle.attitude) vehicle.attitude = draft.vehicle.attitude
  if (draft.vehicle.aero) vehicle.aero = draft.vehicle.aero

  return {
    id: draft.id,
    name: draft.name,
    epoch: draft.epoch,
    bodies: Object.fromEntries(
      Object.entries(bodies).map(([id, b]) => [
        id,
        { position: b.position, velocity: b.velocity, rotationPhase: b.rotationPhase },
      ]),
    ),
    vehicles: [vehicle],
  }
}
