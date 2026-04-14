/**
 * Dormand-Prince RK4(5) adaptive integrator.
 *
 * Translated from SciPy's scipy.integrate._ivp.rk.RK45.
 * Uses FSAL (First Same As Last) to save one derivative evaluation per accepted step.
 */

export type DerivFn = (t: number, y: Float64Array, dydt: Float64Array) => void

// Butcher tableau nodes (time fractions)
const C2 = 1 / 5
const C3 = 3 / 10
const C4 = 4 / 5
const C5 = 8 / 9
// C6 = 1 (not needed explicitly)

// Stage coefficients (A matrix rows)
const A21 = 1 / 5

const A31 = 3 / 40
const A32 = 9 / 40

const A41 = 44 / 45
const A42 = -56 / 15
const A43 = 32 / 9

const A51 = 19372 / 6561
const A52 = -25360 / 2187
const A53 = 64448 / 6561
const A54 = -212 / 729

const A61 = 9017 / 3168
const A62 = -355 / 33
const A63 = 46732 / 5247
const A64 = 49 / 176
const A65 = -5103 / 18656

// 5th-order solution weights (B vector, applied to K0-K5)
const B1 = 35 / 384
// B2 = 0
const B3 = 500 / 1113
const B4 = 125 / 192
const B5 = -2187 / 6784
const B6 = 11 / 84

// Error coefficients E = b4 - b5 (applied to K0-K6, includes FSAL K6)
const E1 = -71 / 57600
// E2 = 0
const E3 = 71 / 16695
const E4 = -71 / 1920
const E5 = 17253 / 339200
const E6 = -22 / 525
const E7 = 1 / 40

// Step size control constants
const SAFETY = 0.9
const MIN_FACTOR = 0.2
const MAX_FACTOR = 10.0
const MAX_STEPS = 1_000_000
const ERROR_EXPONENT = -1 / 5 // -1/(order+1) for RK45

function rmsNorm(v: Float64Array, scale: Float64Array): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    const s = v[i] / scale[i]
    sum += s * s
  }
  return Math.sqrt(sum / v.length)
}

/** Hairer/Norsett/Wanner initial step selection. Reuses caller-owned scratch buffers. */
function selectInitialStep(
  y0: Float64Array,
  t0: number,
  t1: number,
  f0: Float64Array,
  tol: number,
  deriv: DerivFn,
  scratch1: Float64Array, // reused as y1, then diff
  scratch2: Float64Array, // reused as f1
  scale: Float64Array,
): number {
  const n = y0.length
  for (let i = 0; i < n; i++) {
    scale[i] = tol + Math.abs(y0[i]) * tol
  }

  const d0 = rmsNorm(y0, scale)
  const d1 = rmsNorm(f0, scale)

  let h0: number
  if (d0 > 1e-5 && d1 > 1e-5) {
    h0 = 0.01 * d0 / d1
  } else {
    h0 = 1e-6
  }
  h0 = Math.min(h0, t1 - t0)

  // One Euler step to estimate second derivative
  for (let i = 0; i < n; i++) scratch1[i] = y0[i] + h0 * f0[i]
  deriv(t0 + h0, scratch1, scratch2)

  // Reuse scratch1 for diff
  for (let i = 0; i < n; i++) scratch1[i] = (scratch2[i] - f0[i]) / h0
  const d2 = rmsNorm(scratch1, scale)

  let h1: number
  if (d1 > 1e-15 || d2 > 1e-15) {
    h1 = Math.pow(0.01 / Math.max(d1, d2), 1 / 5)
  } else {
    h1 = Math.max(1e-6, h0 * 1e-3)
  }

  return Math.min(100 * h0, h1, t1 - t0)
}

/**
 * Advance state y from t0 to t1 using Dormand-Prince RK4(5) adaptive integration.
 *
 * Modifies y in place and returns it along with the number of accepted steps.
 *
 * @param y      State vector (6 elements: [x, y, z, vx, vy, vz]). Modified in place.
 * @param t0     Start time
 * @param t1     End time
 * @param deriv  Derivative function: (t, y, dydt) => void
 * @param tol    Tolerance (used as both atol and rtol)
 */
export function advanceTo(
  y: Float64Array,
  t0: number,
  t1: number,
  deriv: DerivFn,
  tol: number,
): { y: Float64Array; steps: number } {
  if (t0 >= t1) return { y, steps: 0 }

  const n = y.length
  let t = t0

  // Allocate stage arrays (7 stages for FSAL)
  const K: Float64Array[] = []
  for (let i = 0; i < 7; i++) K[i] = new Float64Array(n)
  const yNew = new Float64Array(n)
  const yTmp = new Float64Array(n)
  const errorVec = new Float64Array(n)
  const scale = new Float64Array(n)

  // Evaluate initial derivative (K0)
  deriv(t, y, K[0])

  // Select initial step size (reuses yTmp, errorVec, scale as scratch)
  let h = selectInitialStep(y, t0, t1, K[0], tol, deriv, yTmp, errorVec, scale)

  let steps = 0
  let wasRejected = false

  while (t < t1) {
    if (steps >= MAX_STEPS) break
    // Detect stagnation: h too small to advance t in floating point
    if (t + h === t) break

    // Clamp step to not overshoot target
    if (t + h > t1) h = t1 - t

    // Stage 2: K1
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * A21 * K[0][i]
    deriv(t + C2 * h, yTmp, K[1])

    // Stage 3: K2
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A31 * K[0][i] + A32 * K[1][i])
    deriv(t + C3 * h, yTmp, K[2])

    // Stage 4: K3
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A41 * K[0][i] + A42 * K[1][i] + A43 * K[2][i])
    deriv(t + C4 * h, yTmp, K[3])

    // Stage 5: K4
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A51 * K[0][i] + A52 * K[1][i] + A53 * K[2][i] + A54 * K[3][i])
    deriv(t + C5 * h, yTmp, K[4])

    // Stage 6: K5 (at t + h)
    for (let i = 0; i < n; i++) yTmp[i] = y[i] + h * (A61 * K[0][i] + A62 * K[1][i] + A63 * K[2][i] + A64 * K[3][i] + A65 * K[4][i])
    deriv(t + h, yTmp, K[5])

    // 5th-order solution (B weights, K0-K5; B2=0 so skip K1)
    for (let i = 0; i < n; i++) {
      yNew[i] = y[i] + h * (B1 * K[0][i] + B3 * K[2][i] + B4 * K[3][i] + B5 * K[4][i] + B6 * K[5][i])
    }

    // FSAL: evaluate K6 = f(t+h, yNew) — reused as K0 of next step
    deriv(t + h, yNew, K[6])

    // Error estimate: h * dot(K[0..6], E)
    for (let i = 0; i < n; i++) {
      errorVec[i] = h * (
        E1 * K[0][i] +
        E3 * K[2][i] +
        E4 * K[3][i] +
        E5 * K[4][i] +
        E6 * K[5][i] +
        E7 * K[6][i]
      )
    }

    // Scale: atol + max(|y|, |yNew|) * rtol
    for (let i = 0; i < n; i++) {
      scale[i] = tol + Math.max(Math.abs(y[i]), Math.abs(yNew[i])) * tol
    }

    const errorNorm = rmsNorm(errorVec, scale)

    if (errorNorm <= 1.0) {
      // Accept step
      t += h
      for (let i = 0; i < n; i++) y[i] = yNew[i]
      steps++

      // FSAL: K0 for next step is K6 from this step
      const tmp = K[0]
      K[0] = K[6]
      K[6] = tmp

      // Grow step size
      let factor: number
      if (errorNorm === 0) {
        factor = MAX_FACTOR
      } else {
        factor = Math.min(MAX_FACTOR, SAFETY * Math.pow(errorNorm, ERROR_EXPONENT))
      }
      if (wasRejected) factor = Math.min(1.0, factor)
      wasRejected = false
      h *= factor
    } else {
      // Reject step, shrink
      const factor = Math.max(MIN_FACTOR, SAFETY * Math.pow(errorNorm, ERROR_EXPONENT))
      wasRejected = true
      h *= factor
    }
  }

  return { y, steps }
}
