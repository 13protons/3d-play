import { describe, it, expect } from 'vitest'
import {
  resolveScene,
  descendantsOf,
  surfacePlacementToRelativeState,
  buildDraftFromScenario,
  type SceneDraft,
  type BodyResolveMeta,
} from '../sceneDraft'
import { toAbsolute } from '../../sim/coordinates'
import { G } from '../../sim/constants'

const sunGm = G * 1.989e30
const earthGm = G * 5.972e24
const earthRadius = 6_371_000

const meta: Record<string, BodyResolveMeta> = {
  sun: { parentId: null, gm: sunGm, radius: 696_340_000, axialTilt: 0, angularVelocity: 0 },
  earth: { parentId: 'sun', gm: earthGm, radius: earthRadius, axialTilt: 0, angularVelocity: 7.292e-5 },
  moon: { parentId: 'earth', gm: G * 7.342e22, radius: 1_737_400, axialTilt: 0, angularVelocity: 2.66e-6 },
}

function baseDraft(): SceneDraft {
  return {
    id: 'test',
    name: 'Test',
    epoch: 0,
    baseScenarioId: 'sun-earth-moon',
    bodies: {
      sun: { position: { sector: [0, 0, 0], local: [0, 0, 0] }, velocity: [0, 0, 0], rotationPhase: 0 },
      earth: { position: { sector: [149600, 0, 0], local: [0, 0, 0] }, velocity: [0, 0, 29783], rotationPhase: 0 },
      moon: { position: { sector: [149984, 0, 0], local: [400000, 0, 0] }, velocity: [0, 0, 30805], rotationPhase: 0 },
    },
    parentScrub: { deltaTrueAnomaly: 0 },
    vehicle: {
      id: 'v1',
      name: 'Orbiter',
      parentId: 'earth',
      placement: { mode: 'orbital', a: earthRadius + 400_000, e: 0, i: 0, lan: 0, aop: 0, ta: 0 },
      resources: { dryMass: 9000, fuelMass: 141000 },
    },
  }
}

describe('descendantsOf', () => {
  it('walks the parent chain', () => {
    expect(descendantsOf('sun', meta).sort()).toEqual(['earth', 'moon'])
    expect(descendantsOf('earth', meta)).toEqual(['moon'])
    expect(descendantsOf('moon', meta)).toEqual([])
  })
})

describe('resolveScene — orbital placement', () => {
  it('places the vehicle on a circular orbit at altitude above the parent', () => {
    const scenario = resolveScene(baseDraft(), meta)
    const earthAbs = toAbsolute(scenario.bodies.earth.position)
    const vehAbs = toAbsolute(scenario.vehicles[0].position as never)
    const rel = [vehAbs[0] - earthAbs[0], vehAbs[1] - earthAbs[1], vehAbs[2] - earthAbs[2]]
    expect(Math.hypot(...rel)).toBeCloseTo(earthRadius + 400_000, -2)
    // Velocity is parent velocity plus circular orbital speed.
    const vel = scenario.vehicles[0].velocity as [number, number, number]
    const relV = [vel[0] - 0, vel[1] - 0, vel[2] - 29783]
    expect(Math.hypot(...relV)).toBeCloseTo(Math.sqrt(earthGm / (earthRadius + 400_000)), 0)
  })

  it('carries physics config through verbatim', () => {
    const scenario = resolveScene(baseDraft(), meta)
    expect(scenario.vehicles[0].resources).toEqual({ dryMass: 9000, fuelMass: 141000 })
  })
})

describe('resolveScene — surface placement', () => {
  it('pins the vehicle at radius + altitude and co-rotates with the surface', () => {
    const draft = baseDraft()
    draft.vehicle.placement = {
      mode: 'surface',
      lat: 0.5,
      lon: 1.0,
      altitude: 0,
      surfaceVelocity: [0, 0, 0],
    }
    const scenario = resolveScene(draft, meta)
    const earthAbs = toAbsolute(scenario.bodies.earth.position)
    const vehAbs = toAbsolute(scenario.vehicles[0].position as never)
    const rel: [number, number, number] = [
      vehAbs[0] - earthAbs[0],
      vehAbs[1] - earthAbs[1],
      vehAbs[2] - earthAbs[2],
    ]
    expect(Math.hypot(...rel)).toBeCloseTo(earthRadius, -1)

    // Sitting still on the ground => velocity is pure co-rotation (ω × r),
    // perpendicular to the radial and the spin axis.
    const vel = scenario.vehicles[0].velocity as [number, number, number]
    const relV: [number, number, number] = [vel[0], vel[1], vel[2] - 29783]
    const radialDot = relV[0] * rel[0] + relV[1] * rel[1] + relV[2] * rel[2]
    expect(Math.abs(radialDot) / (Math.hypot(...rel) * Math.hypot(...relV))).toBeLessThan(1e-6)
    // Speed at the equator-ish point ≈ ω · r · cos(lat).
    expect(Math.hypot(...relV)).toBeCloseTo(7.292e-5 * earthRadius * Math.cos(0.5), -1)
  })

  it('recovers the requested latitude', () => {
    const { position } = surfacePlacementToRelativeState({
      lat: 0.7,
      lon: 2.1,
      altitude: 0,
      radius: earthRadius,
      axialTilt: 0,
      angularVelocity: 0,
      rotationPhase: 0,
      surfaceVelocity: [0, 0, 0],
    })
    // axialTilt 0 => spin axis is +y; latitude is asin(y / r).
    const lat = Math.asin(position[1] / Math.hypot(...position))
    expect(lat).toBeCloseTo(0.7, 6)
  })
})

describe('buildDraftFromScenario', () => {
  it('back-derives orbital elements that resolve to the original vehicle state', () => {
    const t = (a: number, b: number, c: number): [number, number, number] => [a, b, c]
    const scenario = {
      bodies: {
        sun: { position: { sector: t(0, 0, 0), local: t(0, 0, 0) }, velocity: t(0, 0, 0) },
        earth: { position: { sector: t(149600, 0, 0), local: t(0, 0, 0) }, velocity: t(0, 0, 29783) },
      },
      vehicles: [
        {
          id: 'vehicle-1',
          name: 'Orbiter',
          parentId: 'earth',
          position: { sector: t(149600, 0, 0), local: t(-6_771_000, 0, 0) },
          velocity: t(0, 0, 29783 + Math.sqrt(earthGm / 6_771_000)),
          resources: { dryMass: 9000, fuelMass: 141000 },
        },
      ],
    }
    const draft = buildDraftFromScenario(scenario, meta, {
      id: 'derived',
      name: 'Derived',
      baseScenarioId: 'sun-earth-moon',
    })
    expect(draft.vehicle.placement.mode).toBe('orbital')

    const resolved = resolveScene(draft, meta)
    const origAbs = toAbsolute(scenario.vehicles[0].position)
    const newAbs = toAbsolute(resolved.vehicles[0].position as never)
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(newAbs[i] - origAbs[i])).toBeLessThan(1000) // within 1 km
    }
    expect(draft.vehicle.resources).toEqual({ dryMass: 9000, fuelMass: 141000 })
  })
})

describe('resolveScene — parent orbital-phase scrub', () => {
  it('is a no-op at zero delta', () => {
    const a = resolveScene(baseDraft(), meta)
    const draft = baseDraft()
    draft.parentScrub.deltaTrueAnomaly = 0
    const b = resolveScene(draft, meta)
    expect(b.bodies.earth.position).toEqual(a.bodies.earth.position)
  })

  it('moves the parent along its orbit and co-translates satellites rigidly', () => {
    const base = resolveScene(baseDraft(), meta)
    const draft = baseDraft()
    draft.parentScrub.deltaTrueAnomaly = 1.0
    const scrubbed = resolveScene(draft, meta)

    const earthBefore = toAbsolute(base.bodies.earth.position)
    const earthAfter = toAbsolute(scrubbed.bodies.earth.position)
    // Earth actually moved.
    expect(Math.hypot(
      earthAfter[0] - earthBefore[0],
      earthAfter[1] - earthBefore[1],
      earthAfter[2] - earthBefore[2],
    )).toBeGreaterThan(1e8)

    // Moon's position relative to Earth is preserved (rigid co-translation).
    const moonBefore = toAbsolute(base.bodies.moon.position)
    const moonAfter = toAbsolute(scrubbed.bodies.moon.position)
    const relBefore = [moonBefore[0] - earthBefore[0], moonBefore[1] - earthBefore[1], moonBefore[2] - earthBefore[2]]
    const relAfter = [moonAfter[0] - earthAfter[0], moonAfter[1] - earthAfter[1], moonAfter[2] - earthAfter[2]]
    for (let i = 0; i < 3; i++) expect(relAfter[i]).toBeCloseTo(relBefore[i], 1)

    // Vehicle stays at the same offset from its (moved) parent.
    const vehAfter = toAbsolute(scrubbed.vehicles[0].position as never)
    const relVeh = Math.hypot(vehAfter[0] - earthAfter[0], vehAfter[1] - earthAfter[1], vehAfter[2] - earthAfter[2])
    expect(relVeh).toBeCloseTo(earthRadius + 400_000, -2)
  })
})
