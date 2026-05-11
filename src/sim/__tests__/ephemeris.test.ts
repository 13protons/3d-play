import { describe, expect, it } from 'vitest'
import { packStateVectors, toSectorPosition } from '../ephemeris'
import { advanceTo } from '../integrator/adaptive'
import { nBodyDerivativesFromGMs } from '../integrator/derivatives'
import {
  JPL_FULL_SOLAR_SYSTEM_INITIAL,
  JPL_FULL_SOLAR_SYSTEM_ONE_YEAR,
  ONE_YEAR_SECONDS,
} from '../__fixtures__/jpl-full-solar-system'

const GM_BY_ID = new Map([
  ['sun', 132712440041.93938e9],
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

describe('toSectorPosition', () => {
  it('normalizes positive and negative absolute meters to sector/local coordinates', () => {
    expect(toSectorPosition(1_500_000)).toEqual({ sector: 1, local: 500_000 })
    expect(toSectorPosition(-500_000)).toEqual({ sector: -1, local: 500_000 })
  })
})

describe('JPL full solar system fixture', () => {
  it('keeps major planets close to the one-year JPL reference snapshot', () => {
    const state = packStateVectors(JPL_FULL_SOLAR_SYSTEM_INITIAL)
    const gms = JPL_FULL_SOLAR_SYSTEM_INITIAL.map((body) => {
      const gm = GM_BY_ID.get(body.id)
      if (gm === undefined) throw new Error(`Missing GM for ${body.id}`)
      return gm
    })

    advanceTo(state, 0, ONE_YEAR_SECONDS, nBodyDerivativesFromGMs(gms), 1e-10)

    const references = new Map(
      JPL_FULL_SOLAR_SYSTEM_ONE_YEAR.map((body) => [body.id, body.position]),
    )
    const tolerances = new Map([
      ['mercury', 1e8],
      ['venus', 1e8],
      ['earth', 1e8],
      ['mars', 1e8],
      ['jupiter', 1e8],
      ['saturn', 1e8],
      ['uranus', 1e8],
      ['neptune', 1e8],
    ])

    for (let i = 0; i < JPL_FULL_SOLAR_SYSTEM_INITIAL.length; i++) {
      const id = JPL_FULL_SOLAR_SYSTEM_INITIAL[i].id
      const tolerance = tolerances.get(id)
      if (tolerance === undefined) continue
      const actual: [number, number, number] = [state[i * 6], state[i * 6 + 1], state[i * 6 + 2]]
      const expected = references.get(id)
      if (!expected) throw new Error(`Missing reference for ${id}`)
      expect(distance(actual, expected), id).toBeLessThan(tolerance)
    }
  })
})
