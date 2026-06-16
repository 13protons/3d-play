import { describe, expect, it } from 'vitest'
import { packStateVectors } from '../ephemeris'
import {
  JPL_FULL_SOLAR_SYSTEM_INITIAL,
  JPL_FULL_SOLAR_SYSTEM_TEN_YEAR,
  TEN_YEAR_SECONDS,
} from '../__fixtures__/jpl-full-solar-system'

const ONE_MINUTE_SECONDS = 60
const TEN_YEAR_MINUTE_STEPS = TEN_YEAR_SECONDS / ONE_MINUTE_SECONDS

const GM_BY_ID = new Map([
  ['sun', 1.3271244004193939e20],
  ['mercury', 22031.86855e9],
  ['venus', 324858.592e9],
  ['earth', 398600.435436e9],
  ['moon', 4902.800066e9],
  ['mars', 42828.375662e9],
  ['phobos', 711338.337],
  ['deimos', 98517.417],
  ['jupiter', 126686531.900e9],
  ['saturn', 37931206.234e9],
  ['uranus', 5793950.6103e9],
  ['neptune', 6835099.97e9],
])

function distance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function computeAccelerations(
  state: Float64Array,
  gms: number[],
  out: Float64Array,
): void {
  const n = gms.length
  out.fill(0)
  for (let i = 0; i < n; i++) {
    const bi = i * 6
    for (let j = i + 1; j < n; j++) {
      const bj = j * 6
      const dx = state[bj] - state[bi]
      const dy = state[bj + 1] - state[bi + 1]
      const dz = state[bj + 2] - state[bi + 2]
      const r2 = dx * dx + dy * dy + dz * dz
      const r = Math.sqrt(r2)
      const invR3 = 1 / (r2 * r)
      const fi = gms[j] * invR3
      const fj = gms[i] * invR3
      out[bi] += fi * dx
      out[bi + 1] += fi * dy
      out[bi + 2] += fi * dz
      out[bj] -= fj * dx
      out[bj + 1] -= fj * dy
      out[bj + 2] -= fj * dz
    }
  }
}

function advanceVelocityVerlet(
  state: Float64Array,
  gms: number[],
  dt: number,
  steps: number,
): void {
  const n = gms.length
  const acc = new Float64Array(n * 6)
  const nextAcc = new Float64Array(n * 6)
  computeAccelerations(state, gms, acc)

  for (let step = 0; step < steps; step++) {
    for (let i = 0; i < n; i++) {
      const b = i * 6
      state[b] += state[b + 3] * dt + 0.5 * acc[b] * dt * dt
      state[b + 1] += state[b + 4] * dt + 0.5 * acc[b + 1] * dt * dt
      state[b + 2] += state[b + 5] * dt + 0.5 * acc[b + 2] * dt * dt
    }

    computeAccelerations(state, gms, nextAcc)

    for (let i = 0; i < n; i++) {
      const b = i * 6
      state[b + 3] += 0.5 * (acc[b] + nextAcc[b]) * dt
      state[b + 4] += 0.5 * (acc[b + 1] + nextAcc[b + 1]) * dt
      state[b + 5] += 0.5 * (acc[b + 2] + nextAcc[b + 2]) * dt
      acc[b] = nextAcc[b]
      acc[b + 1] = nextAcc[b + 1]
      acc[b + 2] = nextAcc[b + 2]
    }
  }
}

describe('ten-year fixed-step ephemeris report', () => {
  it('prints ten-year drift with exactly one fixed step per minute', () => {
    expect(TEN_YEAR_MINUTE_STEPS).toBe(5_258_880)

    const state = packStateVectors(JPL_FULL_SOLAR_SYSTEM_INITIAL)
    const gms = JPL_FULL_SOLAR_SYSTEM_INITIAL.map((body) => {
      const gm = GM_BY_ID.get(body.id)
      if (gm === undefined) throw new Error(`Missing GM for ${body.id}`)
      return gm
    })
    advanceVelocityVerlet(state, gms, ONE_MINUTE_SECONDS, TEN_YEAR_MINUTE_STEPS)

    const references = new Map(JPL_FULL_SOLAR_SYSTEM_TEN_YEAR.map((body) => [body.id, body.position]))
    console.log(`fixed steps: ${TEN_YEAR_MINUTE_STEPS}`)
    for (let i = 0; i < JPL_FULL_SOLAR_SYSTEM_INITIAL.length; i++) {
      const id = JPL_FULL_SOLAR_SYSTEM_INITIAL[i].id
      const expected = references.get(id)
      if (!expected) continue
      const actual: [number, number, number] = [state[i * 6], state[i * 6 + 1], state[i * 6 + 2]]
      const driftMeters = distance(actual, expected)
      console.log(`${id}: ${(driftMeters / 1000).toFixed(0)} km`)

      if (id === 'jupiter' || id === 'saturn') {
        expect(driftMeters, id).toBeLessThan(10_000_000)
      }
    }
  }, 20_000)
})
