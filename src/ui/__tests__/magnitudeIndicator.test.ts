import { describe, expect, it } from 'vitest'
import {
  ANGULAR_RATE_SCALE_RAD_PER_SECOND,
  computeMagnitudeIndicatorTone,
  computeAngularRateForCentripetalAcceleration,
  computeMagnitudeIndicatorClipInset,
  computeMagnitudeIndicatorFill,
} from '../magnitudeIndicatorMath'

describe('computeMagnitudeIndicatorFill', () => {
  it('fills right from center for positive values', () => {
    expect(computeMagnitudeIndicatorFill({ value: 0.5, min: -1, max: 1 })).toMatchObject({
      side: 'positive',
      percent: 50,
    })
  })

  it('fills left from center for negative values', () => {
    expect(computeMagnitudeIndicatorFill({ value: -0.25, min: -1, max: 1 })).toMatchObject({
      side: 'negative',
      percent: 25,
    })
  })

  it('clamps values to the configured signed range', () => {
    expect(computeMagnitudeIndicatorFill({ value: 3, min: -1, max: 1 })).toMatchObject({
      side: 'positive',
      percent: 100,
    })
    expect(computeMagnitudeIndicatorFill({ value: -4, min: -2, max: 2 })).toMatchObject({
      side: 'negative',
      percent: 100,
    })
  })

  it('renders zero as an empty centered indicator', () => {
    expect(computeMagnitudeIndicatorFill({ value: 0, min: -1, max: 1 })).toMatchObject({
      side: 'zero',
      percent: 0,
    })
  })

  it('returns row span percentages from the shared rail center', () => {
    expect(computeMagnitudeIndicatorFill({ value: 3.17, min: -6.34, max: 6.34 })).toMatchObject({
      leftPercent: 50,
      widthPercent: 25,
    })
    expect(computeMagnitudeIndicatorFill({ value: -6.34, min: -6.34, max: 6.34 })).toMatchObject({
      leftPercent: 0,
      widthPercent: 50,
    })
  })
})

describe('computeMagnitudeIndicatorTone', () => {
  it('marks values above the danger threshold as danger', () => {
    expect(computeMagnitudeIndicatorTone({ value: 5.49, dangerThreshold: 5.5 })).toBe('normal')
    expect(computeMagnitudeIndicatorTone({ value: 5.5, dangerThreshold: 5.5 })).toBe('normal')
    expect(computeMagnitudeIndicatorTone({ value: 5.51, dangerThreshold: 5.5 })).toBe('danger')
    expect(computeMagnitudeIndicatorTone({ value: -5.51, dangerThreshold: 5.5 })).toBe('danger')
  })
})

describe('computeMagnitudeIndicatorClipInset', () => {
  it('clips overlay text to the filled span', () => {
    expect(computeMagnitudeIndicatorClipInset({ leftPercent: 50, widthPercent: 25 })).toBe('inset(0 25% 0 50%)')
    expect(computeMagnitudeIndicatorClipInset({ leftPercent: 0, widthPercent: 50 })).toBe('inset(0 50% 0 0%)')
  })
})

describe('computeAngularRateForCentripetalAcceleration', () => {
  it('uses an Apollo-command-module-scale radius for the angular rate indicator scale', () => {
    expect(computeAngularRateForCentripetalAcceleration({
      accelerationMetersPerSecondSquared: 8 * 9.80665,
      radiusMeters: 1.95,
    })).toBeCloseTo(6.34, 2)
    expect(ANGULAR_RATE_SCALE_RAD_PER_SECOND).toBeCloseTo(6.34, 2)
  })
})
