import { describe, expect, it } from 'vitest'
import {
  STANDARD_GRAVITY,
  burnTimeForDeltaV,
  deltaVBudget,
  exhaustVelocity,
  fuelBurned,
  fuelLimitedThrottle,
  massFlowRate,
} from '../thrust'

describe('massFlowRate', () => {
  it('is thrust / exhaust velocity at full throttle', () => {
    // ṁ = F / (Isp·g₀) = 300000 / (300·9.80665) ≈ 101.97 kg/s
    expect(massFlowRate(300_000, 300, 1)).toBeCloseTo(300_000 / (300 * STANDARD_GRAVITY), 5)
  })

  it('scales with throttle and is zero when off or unpowered', () => {
    expect(massFlowRate(300_000, 300, 0.5)).toBeCloseTo(massFlowRate(300_000, 300, 1) / 2, 6)
    expect(massFlowRate(300_000, 300, 0)).toBe(0)
    expect(massFlowRate(300_000, 0, 1)).toBe(0)
    expect(massFlowRate(0, 300, 1)).toBe(0)
  })
})

describe('exhaustVelocity', () => {
  it('converts Isp to m/s and guards non-positive Isp', () => {
    expect(exhaustVelocity(300)).toBeCloseTo(2941.995, 3)
    expect(exhaustVelocity(0)).toBe(0)
  })
})

describe('fuelLimitedThrottle', () => {
  const base = { maxThrust: 300_000, isp: 300, throttle: 1 }

  it('passes the commanded throttle through while fuel lasts', () => {
    expect(fuelLimitedThrottle({ ...base, fuelMass: 10_000, elapsedSeconds: 1 })).toBe(1)
  })

  it('scales down on the step that empties the tank so avg thrust matches fuel', () => {
    // Full-throttle flow ≈ 101.97 kg/s; only 50.985 kg left for a 1s step → half.
    const flow = massFlowRate(300_000, 300, 1)
    const t = fuelLimitedThrottle({ ...base, fuelMass: flow / 2, elapsedSeconds: 1 })
    expect(t).toBeCloseTo(0.5, 6)
  })

  it('is zero with no fuel or no throttle', () => {
    expect(fuelLimitedThrottle({ ...base, fuelMass: 0, elapsedSeconds: 1 })).toBe(0)
    expect(fuelLimitedThrottle({ ...base, throttle: 0, fuelMass: 100, elapsedSeconds: 1 })).toBe(0)
  })
})

describe('fuelBurned', () => {
  it('burns ṁ·dt and never more than what remains', () => {
    expect(fuelBurned({ maxThrust: 300_000, isp: 300, throttle: 1, fuelMass: 10_000, elapsedSeconds: 2 })).toBeCloseTo(
      massFlowRate(300_000, 300, 1) * 2,
      5,
    )
    // Tank nearly empty: clamps to the remaining mass.
    expect(fuelBurned({ maxThrust: 300_000, isp: 300, throttle: 1, fuelMass: 5, elapsedSeconds: 10 })).toBe(5)
  })

  it('the fuel-limited throttle burns exactly the remaining fuel over the step', () => {
    const step = { maxThrust: 300_000, isp: 300, throttle: 1, fuelMass: 30, elapsedSeconds: 5 }
    const limited = fuelLimitedThrottle(step)
    expect(fuelBurned({ ...step, throttle: limited })).toBeCloseTo(30, 6)
  })
})

describe('deltaVBudget', () => {
  it('matches the Tsiolkovsky rocket equation', () => {
    // ΔV = Isp·g₀·ln(wet/dry) = 2941.995·ln(24000/9000) ≈ 2886 m/s
    expect(deltaVBudget(24_000, 9_000, 300)).toBeCloseTo(exhaustVelocity(300) * Math.log(24_000 / 9_000), 3)
  })

  it('is zero with no propellant or invalid inputs', () => {
    expect(deltaVBudget(9_000, 9_000, 300)).toBe(0)
    expect(deltaVBudget(24_000, 9_000, 0)).toBe(0)
  })
})

describe('burnTimeForDeltaV', () => {
  it('falls between the constant-initial-mass and constant-final-mass estimates', () => {
    // As propellant burns the craft lightens and accelerates faster, so the
    // real time is shorter than m₀·ΔV/F and longer than m_final·ΔV/F.
    const wet = 24_000
    const dV = 500
    const real = burnTimeForDeltaV(dV, 300_000, 300, wet)
    const finalMass = wet * Math.exp(-dV / exhaustVelocity(300))
    expect(real).toBeLessThan((dV * wet) / 300_000)
    expect(real).toBeGreaterThan((dV * finalMass) / 300_000)
  })

  it('round-trips against deltaVBudget at full depletion', () => {
    // Burning the whole budget should take fuelMass / massFlow seconds.
    const wet = 24_000
    const dry = 9_000
    const dV = deltaVBudget(wet, dry, 300)
    const flow = massFlowRate(300_000, 300, 1)
    expect(burnTimeForDeltaV(dV, 300_000, 300, wet)).toBeCloseTo((wet - dry) / flow, 3)
  })

  it('returns 0 for no ΔV', () => {
    expect(burnTimeForDeltaV(0, 300_000, 300, 24_000)).toBe(0)
  })
})
