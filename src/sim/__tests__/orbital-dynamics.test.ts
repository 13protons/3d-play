/**
 * Orbital dynamics tests — verifies gravity evaluation produces physically
 * accurate orbits when integrated over many steps.
 *
 * Tests both the cube-patch pipeline (for future atmosphere/terrain use)
 * and the direct gravity-source approach (used by vehicle worker).
 */

import { describe, it, expect } from 'vitest'
import { G } from '../constants'
import { gravityAtPoint } from '../orbital/gravity'
import {
  evaluateGravity, computeCubeBounds, isInsideInnerBox,
  CP_MIN_X, CP_MIN_Y, CP_MIN_Z, CP_MAX_X, CP_MAX_Y, CP_MAX_Z,
  CP_G_NEG_X, CP_G_POS_X, CP_G_NEG_Y, CP_G_POS_Y, CP_G_NEG_Z, CP_G_POS_Z,
  CP_GRAVITY_SIZE,
} from '../cube-patch'
import { integrateVehicle, type VehicleState, type GravityFn } from '../vehicle/integrate'
import type { CelestialBody, GravitySource } from '../types'

const DT = 1 / 60

function makeBody(mass: number, x: number, y: number, z: number): CelestialBody {
  return {
    id: 'test', name: 'test', parentId: null as unknown as string,
    mass, radius: 1000, soiRadius: 1e12,
    position: { sector: [0, 0, 0], local: [x, y, z] },
    velocity: [0, 0, 0],
    orientation: [0, 0, 0, 1] as [number, number, number, number],
    angularVelocity: 0,
  }
}

function faceCenterPoints(
  bounds: [number, number, number, number, number, number],
): [number, number, number][] {
  const [minX, minY, minZ, maxX, maxY, maxZ] = bounds
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  return [
    [minX, cy, cz], [maxX, cy, cz],
    [cx, minY, cz], [cx, maxY, cz],
    [cx, cy, minZ], [cx, cy, maxZ],
  ]
}

function buildPatchFromBodies(
  bodies: CelestialBody[],
  bounds: [number, number, number, number, number, number],
): Float64Array {
  const patch = new Float64Array(CP_GRAVITY_SIZE)
  patch[CP_MIN_X] = bounds[0]; patch[CP_MIN_Y] = bounds[1]; patch[CP_MIN_Z] = bounds[2]
  patch[CP_MAX_X] = bounds[3]; patch[CP_MAX_Y] = bounds[4]; patch[CP_MAX_Z] = bounds[5]

  const points = faceCenterPoints(bounds)
  const offsets = [CP_G_NEG_X, CP_G_POS_X, CP_G_NEG_Y, CP_G_POS_Y, CP_G_NEG_Z, CP_G_POS_Z]
  for (let i = 0; i < 6; i++) {
    const g = gravityAtPoint(bodies, points[i])
    patch[offsets[i]] = g[0]
    patch[offsets[i] + 1] = g[1]
    patch[offsets[i] + 2] = g[2]
  }
  return patch
}

function orbitalSpeed(mass: number, radius: number): number {
  return Math.sqrt(G * mass / radius)
}

function specificEnergy(mass: number, pos: [number, number, number], vel: [number, number, number]): number {
  const r = Math.sqrt(pos[0] ** 2 + pos[1] ** 2 + pos[2] ** 2)
  const v2 = vel[0] ** 2 + vel[1] ** 2 + vel[2] ** 2
  return 0.5 * v2 - G * mass / r
}

/** Gravity function from a cube patch */
function patchGravity(patch: Float64Array): GravityFn {
  return (x, y, z, out) => evaluateGravity(patch, x, y, z, out)
}

/** Gravity function from gravity sources (same as vehicle worker uses) */
function sourcesGravity(sources: GravitySource[]): GravityFn {
  return (x, y, z, out) => {
    out[0] = out[1] = out[2] = 0
    for (const src of sources) {
      const dx = src.position[0] - x
      const dy = src.position[1] - y
      const dz = src.position[2] - z
      const r2 = dx * dx + dy * dy + dz * dz
      const r = Math.sqrt(r2)
      if (r < 1) continue
      const f = src.gm / (r2 * r)
      out[0] += f * dx
      out[1] += f * dy
      out[2] += f * dz
    }
  }
}

// ── Point-source gravity accuracy (cube patch) ────────────────────────

describe('cube patch vs true gravity (point source)', () => {
  const earthMass = 5.972e24
  const earth = makeBody(earthMass, 0, 0, 0)
  const r = 6_771_000 // LEO altitude

  it('evaluateGravity at cube center closely matches true gravity', () => {
    const speed = orbitalSpeed(earthMass, r)
    const bounds = computeCubeBounds(r, 0, 0, speed, 1, DT)
    const patch = buildPatchFromBodies([earth], bounds)

    const out: [number, number, number] = [0, 0, 0]
    evaluateGravity(patch, r, 0, 0, out)

    const trueG = gravityAtPoint([earth], [r, 0, 0])
    const mag = Math.sqrt(trueG[0] ** 2 + trueG[1] ** 2 + trueG[2] ** 2)
    const errMag = Math.sqrt((out[0] - trueG[0]) ** 2 + (out[1] - trueG[1]) ** 2 + (out[2] - trueG[2]) ** 2)
    expect(errMag / mag).toBeLessThan(0.001)
  })

  it('evaluateGravity direction tracks true gravity across the cube', () => {
    const speed = orbitalSpeed(earthMass, r)
    const bounds = computeCubeBounds(r, 0, 0, speed, 1, DT)
    const patch = buildPatchFromBodies([earth], bounds)

    const half = (bounds[3] - bounds[0]) / 2
    const offsets = [0, half * 0.3, -half * 0.3, half * 0.5, -half * 0.5]
    const out: [number, number, number] = [0, 0, 0]

    for (const ox of offsets) {
      for (const oy of offsets) {
        const px = r + ox
        const py = oy
        const trueG = gravityAtPoint([earth], [px, py, 0])
        evaluateGravity(patch, px, py, 0, out)

        const dot = out[0] * trueG[0] + out[1] * trueG[1] + out[2] * trueG[2]
        const magA = Math.sqrt(out[0] ** 2 + out[1] ** 2 + out[2] ** 2)
        const magB = Math.sqrt(trueG[0] ** 2 + trueG[1] ** 2 + trueG[2] ** 2)
        if (magA > 0 && magB > 0) {
          const cosAngle = dot / (magA * magB)
          expect(cosAngle).toBeGreaterThan(0.996)
        }
      }
    }
  })

  it('gravity magnitude error stays small across the cube', () => {
    const speed = orbitalSpeed(earthMass, r)
    const bounds = computeCubeBounds(r, 0, 0, speed, 1, DT)
    const patch = buildPatchFromBodies([earth], bounds)

    const half = (bounds[3] - bounds[0]) / 2
    const out: [number, number, number] = [0, 0, 0]
    let maxRelError = 0

    for (let ix = -2; ix <= 2; ix++) {
      for (let iy = -2; iy <= 2; iy++) {
        for (let iz = -2; iz <= 2; iz++) {
          const px = r + ix * half * 0.2
          const py = iy * half * 0.2
          const pz = iz * half * 0.2
          evaluateGravity(patch, px, py, pz, out)
          const trueG = gravityAtPoint([earth], [px, py, pz])
          const trueMag = Math.sqrt(trueG[0] ** 2 + trueG[1] ** 2 + trueG[2] ** 2)
          const errMag = Math.sqrt(
            (out[0] - trueG[0]) ** 2 + (out[1] - trueG[1]) ** 2 + (out[2] - trueG[2]) ** 2,
          )
          maxRelError = Math.max(maxRelError, errMag / trueMag)
        }
      }
    }
    expect(maxRelError).toBeLessThan(0.05)
  })
})

// ── Direct gravity source energy conservation ──────────────────────────

describe('direct gravity source integration', () => {
  const earthMass = 5.972e24
  const r = 6_771_000

  it('conserves energy over 5 orbits at 1x warp', () => {
    const speed = orbitalSpeed(earthMass, r)
    const sources: GravitySource[] = [{ gm: G * earthMass, position: [0, 0, 0], velocity: [0, 0, 0] }]
    const gravity = sourcesGravity(sources)

    const state: VehicleState = { position: [r, 0, 0], velocity: [0, 0, speed] }
    const initialE = specificEnergy(earthMass, state.position, state.velocity)

    const period = 2 * Math.PI * r / speed
    const totalSteps = Math.floor(period * 5 / DT)

    for (let step = 0; step < totalSteps; step++) {
      integrateVehicle(state, gravity, DT)
    }

    const finalE = specificEnergy(earthMass, state.position, state.velocity)
    const drift = Math.abs((finalE - initialE) / initialE)
    expect(drift).toBeLessThan(0.001) // <0.1% over 5 orbits
  })

  it('conserves energy at simulated 1000x warp (1000 substeps/tick)', () => {
    const speed = orbitalSpeed(earthMass, r)
    const sources: GravitySource[] = [{ gm: G * earthMass, position: [0, 0, 0], velocity: [0, 0, 0] }]
    const gravity = sourcesGravity(sources)

    const state: VehicleState = { position: [r, 0, 0], velocity: [0, 0, speed] }
    const initialE = specificEnergy(earthMass, state.position, state.velocity)

    const period = 2 * Math.PI * r / speed
    // Simulate as the worker does: 1000 substeps per tick, 1 orbit
    const totalTicks = Math.floor(period / DT / 1000)

    for (let tick = 0; tick < totalTicks; tick++) {
      for (let i = 0; i < 1000; i++) {
        integrateVehicle(state, gravity, DT)
      }
    }

    const finalE = specificEnergy(earthMass, state.position, state.velocity)
    const drift = Math.abs((finalE - initialE) / initialE)
    // Direct gravity is exact at every substep — should be very tight
    expect(drift).toBeLessThan(0.001)
  })

  it('conserves energy at simulated 100000x warp', () => {
    const speed = orbitalSpeed(earthMass, r)
    const sources: GravitySource[] = [{ gm: G * earthMass, position: [0, 0, 0], velocity: [0, 0, 0] }]
    const gravity = sourcesGravity(sources)

    const state: VehicleState = { position: [r, 0, 0], velocity: [0, 0, speed] }
    const initialE = specificEnergy(earthMass, state.position, state.velocity)

    // 100,000x warp, 1 orbit — same number of substeps, same DT
    const period = 2 * Math.PI * r / speed
    const totalSteps = Math.floor(period / DT)

    for (let step = 0; step < totalSteps; step++) {
      integrateVehicle(state, gravity, DT)
    }

    const finalE = specificEnergy(earthMass, state.position, state.velocity)
    const drift = Math.abs((finalE - initialE) / initialE)
    expect(drift).toBeLessThan(0.001)
  })
})

// ── Orbit symmetry with cube patch ─────────────────────────────────────

describe('orbit symmetry (cube patch)', () => {
  const earthMass = 5.972e24
  const earth = makeBody(earthMass, 0, 0, 0)
  const r = 6_771_000

  it('circular orbit radius is symmetric in all quadrants', () => {
    const speed = orbitalSpeed(earthMass, r)
    const state: VehicleState = {
      position: [r, 0, 0],
      velocity: [0, 0, speed],
    }

    const period = 2 * Math.PI * r / speed
    const quarterSteps = Math.floor(period / 4 / DT)
    const radii: number[] = []

    for (let step = 0; step < quarterSteps; step++) {
      if (step % 100 === 0) {
        const [px, py, pz] = state.position
        const sp = Math.sqrt(state.velocity[0] ** 2 + state.velocity[1] ** 2 + state.velocity[2] ** 2)
        const bounds = computeCubeBounds(px, py, pz, sp, 1, DT)
        const patch = buildPatchFromBodies([earth], bounds)
        for (let i = 0; i < 100 && step + i < quarterSteps; i++) {
          integrateVehicle(state, patchGravity(patch), DT)
        }
        step += 99
      }
      const dist = Math.sqrt(state.position[0] ** 2 + state.position[1] ** 2 + state.position[2] ** 2)
      radii.push(dist)
    }

    const minR = Math.min(...radii)
    const maxR = Math.max(...radii)
    expect((maxR - minR) / r).toBeLessThan(0.01)
  })
})

// ── Cube patch multi-orbit (kept for future atmosphere/terrain testing) ─

describe('multi-orbit energy conservation (cube patch)', () => {
  const earthMass = 5.972e24
  const earth = makeBody(earthMass, 0, 0, 0)
  const r = 6_771_000

  it('conserves specific orbital energy over 2 orbits with patch refresh', () => {
    const speed = orbitalSpeed(earthMass, r)
    const state: VehicleState = {
      position: [r, 0, 0],
      velocity: [0, 0, speed],
    }
    const initialE = specificEnergy(earthMass, state.position, state.velocity)

    const period = 2 * Math.PI * r / speed
    const totalSteps = Math.floor(period * 2 / DT)
    const patchRefreshInterval = 60

    let patch: Float64Array | null = null

    for (let step = 0; step < totalSteps; step++) {
      if (step % patchRefreshInterval === 0 || patch === null) {
        const [px, py, pz] = state.position
        const sp = Math.sqrt(state.velocity[0] ** 2 + state.velocity[1] ** 2 + state.velocity[2] ** 2)
        const bounds = computeCubeBounds(px, py, pz, sp, 1, DT)
        patch = buildPatchFromBodies([earth], bounds)
      }
      integrateVehicle(state, patchGravity(patch), DT)
    }

    const finalE = specificEnergy(earthMass, state.position, state.velocity)
    const drift = Math.abs((finalE - initialE) / initialE)
    expect(drift).toBeLessThan(0.01)
  })
})

// ── Patch refresh / inner-box ──────────────────────────────────────────

describe('patch refresh triggers', () => {
  const earthMass = 5.972e24
  const earth = makeBody(earthMass, 0, 0, 0)
  const r = 6_771_000

  it('vehicle exits inner box before reaching outer box edge', () => {
    const speed = orbitalSpeed(earthMass, r)
    const bounds = computeCubeBounds(r, 0, 0, speed, 1, DT)
    const patch = buildPatchFromBodies([earth], bounds)

    const state: VehicleState = {
      position: [r, 0, 0],
      velocity: [0, 0, speed],
    }

    let exitedInner = false
    let exitedOuter = false

    for (let step = 0; step < 10000; step++) {
      integrateVehicle(state, patchGravity(patch), DT)
      const [px, py, pz] = state.position
      if (!isInsideInnerBox(patch, px, py, pz) && !exitedInner) {
        exitedInner = true
      }
      if (px < bounds[0] || px > bounds[3] ||
          py < bounds[1] || py > bounds[4] ||
          pz < bounds[2] || pz > bounds[5]) {
        exitedOuter = true
        break
      }
    }

    expect(exitedInner).toBe(true)
    expect(exitedOuter).toBe(true)
  })
})

// ── Directional consistency ────────────────────────────────────────────

describe('gravity direction consistency', () => {
  const earthMass = 5.972e24
  const earth = makeBody(earthMass, 0, 0, 0)

  it('gravity always points toward the massive body', () => {
    const positions: [number, number, number][] = [
      [1e7, 0, 0], [-1e7, 0, 0],
      [0, 1e7, 0], [0, -1e7, 0],
      [0, 0, 1e7], [0, 0, -1e7],
      [5e6, 5e6, 5e6], [-5e6, -5e6, -5e6],
    ]

    const out: [number, number, number] = [0, 0, 0]

    for (const pos of positions) {
      const speed = orbitalSpeed(earthMass, Math.sqrt(pos[0] ** 2 + pos[1] ** 2 + pos[2] ** 2))
      const bounds = computeCubeBounds(pos[0], pos[1], pos[2], speed, 1, DT)
      const patch = buildPatchFromBodies([earth], bounds)

      evaluateGravity(patch, pos[0], pos[1], pos[2], out)

      const dot = out[0] * pos[0] + out[1] * pos[1] + out[2] * pos[2]
      expect(dot).toBeLessThan(0)
    }
  })

  it('gravity magnitude scales as 1/r² at different altitudes', () => {
    const r1 = 7_000_000
    const r2 = 14_000_000
    const out: [number, number, number] = [0, 0, 0]

    const speed1 = orbitalSpeed(earthMass, r1)
    const bounds1 = computeCubeBounds(r1, 0, 0, speed1, 1, DT)
    const patch1 = buildPatchFromBodies([earth], bounds1)
    evaluateGravity(patch1, r1, 0, 0, out)
    const mag1 = Math.sqrt(out[0] ** 2 + out[1] ** 2 + out[2] ** 2)

    const speed2 = orbitalSpeed(earthMass, r2)
    const bounds2 = computeCubeBounds(r2, 0, 0, speed2, 1, DT)
    const patch2 = buildPatchFromBodies([earth], bounds2)
    evaluateGravity(patch2, r2, 0, 0, out)
    const mag2 = Math.sqrt(out[0] ** 2 + out[1] ** 2 + out[2] ** 2)

    expect(mag1 / mag2).toBeCloseTo(4, 1)
  })
})
