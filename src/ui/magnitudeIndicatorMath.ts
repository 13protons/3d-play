type FillSide = 'negative' | 'zero' | 'positive'

interface MagnitudeIndicatorFillInput {
  value: number
  min: number
  max: number
}

interface MagnitudeIndicatorFill {
  side: FillSide
  percent: number
  leftPercent: number
  widthPercent: number
}

const EARTH_GRAVITY_METERS_PER_SECOND_SQUARED = 9.80665
const APOLLO_COMMAND_MODULE_RADIUS_METERS = 1.95

export const ANGULAR_RATE_SCALE_RAD_PER_SECOND = computeAngularRateForCentripetalAcceleration({
  accelerationMetersPerSecondSquared: 8 * EARTH_GRAVITY_METERS_PER_SECOND_SQUARED,
  radiusMeters: APOLLO_COMMAND_MODULE_RADIUS_METERS,
})

export const ANGULAR_RATE_DANGER_THRESHOLD_RAD_PER_SECOND = 5.5

export function computeAngularRateForCentripetalAcceleration({
  accelerationMetersPerSecondSquared,
  radiusMeters,
}: {
  accelerationMetersPerSecondSquared: number
  radiusMeters: number
}) {
  if (accelerationMetersPerSecondSquared <= 0 || radiusMeters <= 0) return 0
  return Math.sqrt(accelerationMetersPerSecondSquared / radiusMeters)
}

export function computeMagnitudeIndicatorFill({ value, min, max }: MagnitudeIndicatorFillInput): MagnitudeIndicatorFill {
  const negativeRange = Math.abs(Math.min(min, 0))
  const positiveRange = Math.max(max, 0)
  if (!Number.isFinite(value) || value === 0) return fillGeometry('zero', 0)

  if (value < 0) {
    if (negativeRange === 0) return fillGeometry('zero', 0)
    return fillGeometry('negative', clampPercent((Math.abs(value) / negativeRange) * 100))
  }

  if (positiveRange === 0) return fillGeometry('zero', 0)
  return fillGeometry('positive', clampPercent((value / positiveRange) * 100))
}

export function computeMagnitudeIndicatorTone({
  value,
  dangerThreshold,
}: {
  value: number
  dangerThreshold?: number
}) {
  if (dangerThreshold === undefined) return 'normal'
  return Math.abs(value) > dangerThreshold ? 'danger' : 'normal'
}

export function computeMagnitudeIndicatorClipInset({
  leftPercent,
  widthPercent,
}: {
  leftPercent: number
  widthPercent: number
}) {
  return `inset(0 ${formatPercent(100 - leftPercent - widthPercent)} 0 ${formatPercent(leftPercent)})`
}

function fillGeometry(side: FillSide, percent: number): MagnitudeIndicatorFill {
  const widthPercent = percent / 2
  return {
    side,
    percent,
    leftPercent: side === 'negative' ? 50 - widthPercent : 50,
    widthPercent,
  }
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value))
}

function formatPercent(value: number) {
  return `${Number(value.toFixed(3))}%`
}
