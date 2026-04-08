import { describe, it, expect } from 'vitest'
import { advanceTo, type DerivFn } from '../integrator/adaptive'
import { G } from '../constants'

describe('advanceTo (Dormand-Prince 4/5)', () => {
  it('integrates constant velocity exactly', () => {
    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      dydt[3] = 0; dydt[4] = 0; dydt[5] = 0
    }
    const y = new Float64Array([0, 0, 0, 100, 0, 0])
    const result = advanceTo(y, 0, 10, deriv, 1e-10)
    expect(result.y[0]).toBeCloseTo(1000, 5)
    expect(result.y[3]).toBeCloseTo(100, 5)
  })

  it('integrates uniform gravity accurately', () => {
    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      dydt[3] = 0; dydt[4] = -9.81; dydt[5] = 0
    }
    const y = new Float64Array([0, 0, 0, 0, 0, 0])
    const result = advanceTo(y, 0, 2, deriv, 1e-10)
    expect(result.y[1]).toBeCloseTo(-0.5 * 9.81 * 4, 5)
    expect(result.y[4]).toBeCloseTo(-9.81 * 2, 5)
  })

  it('conserves energy in circular orbit over 5 orbits', () => {
    const M = 5.972e24
    const r = 6_771_000
    const GM = G * M
    const v = Math.sqrt(GM / r)

    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
      const rr = Math.sqrt(r2)
      const f = -GM / (r2 * rr)
      dydt[3] = f * y[0]; dydt[4] = f * y[1]; dydt[5] = f * y[2]
    }

    const y = new Float64Array([r, 0, 0, 0, 0, v])
    const period = 2 * Math.PI * r / v
    const initialE = 0.5 * v * v - GM / r

    const result = advanceTo(y, 0, period * 5, deriv, 1e-12)

    const finalV2 = result.y[3] ** 2 + result.y[4] ** 2 + result.y[5] ** 2
    const finalR = Math.sqrt(result.y[0] ** 2 + result.y[1] ** 2 + result.y[2] ** 2)
    const finalE = 0.5 * finalV2 - GM / finalR
    const drift = Math.abs((finalE - initialE) / initialE)

    expect(drift).toBeLessThan(1e-8)
    expect(result.steps).toBeLessThan(2500)
  })

  it('takes fewer steps for smooth orbits than perturbed ones', () => {
    const M = 5.972e24
    const r = 6_771_000
    const GM = G * M
    const v = Math.sqrt(GM / r)
    const period = 2 * Math.PI * r / v

    const smoothDeriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
      const rr = Math.sqrt(r2)
      const f = -GM / (r2 * rr)
      dydt[3] = f * y[0]; dydt[4] = f * y[1]; dydt[5] = f * y[2]
    }

    const y1 = new Float64Array([r, 0, 0, 0, 0, v])
    const smooth = advanceTo(y1, 0, period, smoothDeriv, 1e-10)

    const pertGM = G * 7.348e22
    const pertPos = [r + 500_000, 0, 0]
    const perturbedDeriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      const r2 = y[0] * y[0] + y[1] * y[1] + y[2] * y[2]
      const rr = Math.sqrt(r2)
      const f = -GM / (r2 * rr)
      dydt[3] = f * y[0]; dydt[4] = f * y[1]; dydt[5] = f * y[2]
      const dx = pertPos[0] - y[0], dy = pertPos[1] - y[1], dz = pertPos[2] - y[2]
      const pr2 = dx * dx + dy * dy + dz * dz
      const pr = Math.sqrt(pr2)
      const pf = pertGM / (pr2 * pr)
      dydt[3] += pf * dx; dydt[4] += pf * dy; dydt[5] += pf * dz
    }

    const y2 = new Float64Array([r, 0, 0, 0, 0, v])
    const perturbed = advanceTo(y2, 0, period, perturbedDeriv, 1e-10)

    expect(perturbed.steps).toBeGreaterThan(smooth.steps)
  })

  it('lands exactly on targetTime', () => {
    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      dydt[3] = 0; dydt[4] = 0; dydt[5] = 0
    }
    const y = new Float64Array([0, 0, 0, 1, 0, 0])
    const target = 7.777
    const result = advanceTo(y, 0, target, deriv, 1e-10)
    expect(result.y[0]).toBeCloseTo(target, 10)
  })

  it('handles very short time spans', () => {
    const deriv: DerivFn = (_t, y, dydt) => {
      dydt[0] = y[3]; dydt[1] = y[4]; dydt[2] = y[5]
      dydt[3] = 0; dydt[4] = 0; dydt[5] = 0
    }
    const y = new Float64Array([0, 0, 0, 100, 0, 0])
    const result = advanceTo(y, 0, 1e-10, deriv, 1e-12)
    expect(result.y[0]).toBeCloseTo(100 * 1e-10, 15)
  })
})
