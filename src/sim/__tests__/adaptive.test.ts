import { describe, it, expect } from 'vitest'
import { advanceTo, type DerivFn } from '../integrator/adaptive'
import { G } from '../constants'

// --- Butcher tableau constants (duplicated from adaptive.ts for validation) ---
const B = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1]
const A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
]

// --- SciPy test helpers ---
// Rational ODE from SciPy's test_ivp.py: has known analytical solution
const funRational: DerivFn = (t, y, dydt) => {
  dydt[0] = y[1] / t
  dydt[1] = y[1] * (y[0] + 2 * y[1] - 1) / (t * (y[0] - 1))
}
const solRational = (t: number): [number, number] =>
  [t / (t + 10), 10 * t / (t + 10) ** 2]

// Normalized RMS error (from SciPy's compute_error)
function computeError(y: Float64Array, yTrue: number[], rtol: number, atol: number): number {
  let sum = 0
  for (let i = 0; i < y.length; i++) {
    const e = (y[i] - yTrue[i]) / (atol + rtol * Math.abs(yTrue[i]))
    sum += e * e
  }
  return Math.sqrt(sum / y.length)
}

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

// ============================================================
// Tests ported from SciPy's test_ivp.py and test_rk.py
// scipy/integrate/_ivp/tests/test_rk.py
// scipy/integrate/_ivp/tests/test_ivp.py
// ============================================================

describe('SciPy-ported: Butcher tableau properties', () => {
  it('B weights sum to 1', () => {
    const sum = B.reduce((s, b) => s + b, 0)
    expect(sum).toBeCloseTo(1, 15)
  })

  it('row sums of A equal C for each stage', () => {
    for (let i = 1; i < A.length; i++) {
      const rowSum = A[i].reduce((s, a) => s + a, 0)
      expect(rowSum).toBeCloseTo(C[i], 14)
    }
  })
})

describe('SciPy-ported: rational ODE accuracy (test_integration)', () => {
  // SciPy's primary accuracy test: rational ODE with known analytical solution
  // y' = [y[1]/t, y[1]*(y[0]+2*y[1]-1)/(t*(y[0]-1))]
  // sol(t) = [t/(t+10), 10t/(t+10)^2]
  // Integrated over [5, 9] with rtol=1e-3, atol=1e-6

  it('solves forward [5, 9] within normalized error < 5', () => {
    const rtol = 1e-3
    const atol = 1e-6
    const y0 = new Float64Array([1 / 3, 2 / 9])
    const result = advanceTo(y0, 5, 9, funRational, atol)

    const yTrue = solRational(9)
    const err = computeError(result.y, yTrue, rtol, atol)
    expect(err).toBeLessThan(5)
  })

  it('achieves tight accuracy at tighter tolerance', () => {
    const tol = 1e-10
    const y0 = new Float64Array([1 / 3, 2 / 9])
    const result = advanceTo(y0, 5, 9, funRational, tol)

    const yTrue = solRational(9)
    // At tol=1e-10, each component should match to ~1e-10
    expect(Math.abs(result.y[0] - yTrue[0])).toBeLessThan(1e-8)
    expect(Math.abs(result.y[1] - yTrue[1])).toBeLessThan(1e-8)
  })
})

describe('SciPy-ported: exponential decay', () => {
  // dy/dt = -y, sol = y0 * exp(-t)
  // SciPy tests this with complex values; we test real-valued

  it('solves exponential decay accurately', () => {
    const deriv: DerivFn = (_t, y, dydt) => {
      for (let i = 0; i < y.length; i++) dydt[i] = -y[i]
    }
    const y0 = new Float64Array([1.0, 2.0, 0.5])
    const tEnd = 3.0
    const tol = 1e-10
    const result = advanceTo(y0, 0, tEnd, deriv, tol)

    const factor = Math.exp(-tEnd)
    expect(result.y[0]).toBeCloseTo(1.0 * factor, 8)
    expect(result.y[1]).toBeCloseTo(2.0 * factor, 8)
    expect(result.y[2]).toBeCloseTo(0.5 * factor, 8)
  })

  it('exponential growth: error is controlled by tolerance', () => {
    // dy/dt = y, sol = exp(t) — tests that step control works under growth
    const deriv: DerivFn = (_t, y, dydt) => {
      for (let i = 0; i < y.length; i++) dydt[i] = y[i]
    }
    const tEnd = 5.0

    // Loose tolerance
    const loose = advanceTo(new Float64Array([1.0]), 0, tEnd, deriv, 1e-3)
    const looseErr = Math.abs(loose.y[0] - Math.exp(tEnd)) / Math.exp(tEnd)

    // Tight tolerance
    const tight = advanceTo(new Float64Array([1.0]), 0, tEnd, deriv, 1e-10)
    const tightErr = Math.abs(tight.y[0] - Math.exp(tEnd)) / Math.exp(tEnd)

    // Tighter tolerance should give smaller error
    expect(tightErr).toBeLessThan(looseErr)
    // And tight should be very accurate
    expect(tightErr).toBeLessThan(1e-8)
  })
})

describe('SciPy-ported: zero RHS (test_integration_zero_rhs)', () => {
  it('preserves constant state with zero derivatives', () => {
    const deriv: DerivFn = (_t, _y, dydt) => {
      for (let i = 0; i < dydt.length; i++) dydt[i] = 0
    }
    const y0 = new Float64Array([1.0, 2.0, 3.0])
    const result = advanceTo(y0, 0, 10, deriv, 1e-10)

    expect(result.y[0]).toBeCloseTo(1.0, 15)
    expect(result.y[1]).toBeCloseTo(2.0, 15)
    expect(result.y[2]).toBeCloseTo(3.0, 15)
  })
})

describe('SciPy-ported: t_bound respected (test_tbound_respected)', () => {
  it('never evaluates derivative past target time', () => {
    const tEnd = 1e-4
    const deriv: DerivFn = (t, y, dydt) => {
      if (t > tEnd * (1 + 1e-12)) {
        throw new Error(`Derivative evaluated at t=${t}, past t_bound=${tEnd}`)
      }
      for (let i = 0; i < y.length; i++) dydt[i] = 2 * y[i]
    }
    const y0 = new Float64Array([1.0])
    // Should not throw
    const result = advanceTo(y0, 0, tEnd, deriv, 1e-10)
    expect(result.y[0]).toBeCloseTo(Math.exp(2 * tEnd), 8)
  })

  it('never evaluates derivative past target time (longer interval)', () => {
    const tStart = 0
    const tEnd = 2.0
    const deriv: DerivFn = (t, y, dydt) => {
      if (t > tEnd * (1 + 1e-12)) {
        throw new Error(`Derivative evaluated at t=${t}, past t_bound=${tEnd}`)
      }
      for (let i = 0; i < y.length; i++) dydt[i] = -y[i]
    }
    const y0 = new Float64Array([10.0, 5.0])
    const result = advanceTo(y0, tStart, tEnd, deriv, 1e-8)
    expect(result.y[0]).toBeCloseTo(10 * Math.exp(-tEnd), 6)
  })
})

describe('SciPy-ported: edge cases', () => {
  it('handles zero-length time interval', () => {
    const deriv: DerivFn = (_t, y, dydt) => {
      for (let i = 0; i < y.length; i++) dydt[i] = 2 * y[i]
    }
    const y0 = new Float64Array([1.0, 2.0])
    const result = advanceTo(y0, 0, 0, deriv, 1e-10)
    // State should be unchanged
    expect(result.y[0]).toBe(1.0)
    expect(result.y[1]).toBe(2.0)
    expect(result.steps).toBe(0)
  })

  it('uses fewer function evaluations for smooth problems', () => {
    // Port of SciPy's nfev < 40 check for rational ODE
    // Our advanceTo returns steps, not nfev, but steps * 6 ≈ nfev for FSAL
    const y0 = new Float64Array([1 / 3, 2 / 9])
    const result = advanceTo(y0, 5, 9, funRational, 1e-6)
    // SciPy achieves < 40 nfev ≈ < 7 steps for this problem
    // Be generous: under 20 steps for [5,9] with tol=1e-6
    expect(result.steps).toBeLessThan(20)
  })

  it('tighter tolerance produces more steps', () => {
    const looseTol = advanceTo(new Float64Array([1 / 3, 2 / 9]), 5, 9, funRational, 1e-3)
    const tightTol = advanceTo(new Float64Array([1 / 3, 2 / 9]), 5, 9, funRational, 1e-12)
    expect(tightTol.steps).toBeGreaterThan(looseTol.steps)
  })
})
