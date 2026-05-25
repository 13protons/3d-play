import { describe, expect, it } from 'vitest'
import {
  orbitLineStyleForBody,
  predictionTrueAnomalies,
  shouldRecomputeOrbitPrediction,
  splitOrbitLineSegments,
  usesUniformOrbitLineOpacity,
} from '../orbitPredictionMath'

describe('shouldRecomputeOrbitPrediction', () => {
  it('recomputes when no prediction has been computed yet', () => {
    expect(shouldRecomputeOrbitPrediction(null, 120, 600)).toBe(true)
  })

  it('waits until the simulated interval has elapsed', () => {
    expect(shouldRecomputeOrbitPrediction(100, 699.9, 600)).toBe(false)
    expect(shouldRecomputeOrbitPrediction(100, 700, 600)).toBe(true)
  })

  it('uses uniform material opacity instead of per-vertex opacity', () => {
    expect(usesUniformOrbitLineOpacity()).toBe(true)
  })
})

describe('orbitLineStyleForBody', () => {
  it('uses orbit-specific colors instead of planet render colors', () => {
    expect(orbitLineStyleForBody('earth', 'earth')).toEqual({ color: '#214bb3', lineWidth: 3, opacity: 1 })
    expect(orbitLineStyleForBody('mars', 'mars').color).toBe('#d75a32')
  })

  it('de-emphasizes non-focused body orbits', () => {
    expect(orbitLineStyleForBody('mars', 'earth')).toEqual({ color: '#6b2d19', lineWidth: 2, opacity: 1 })
  })
})

describe('predictionTrueAnomalies', () => {
  it('adds extra samples within 10 degrees of the body anomaly', () => {
    const currentAnomaly = Math.PI
    const anomalies = predictionTrueAnomalies(currentAnomaly, 36, Math.PI / 18, 24)
    const nearby = anomalies.filter(
      (theta) => Math.abs(theta - currentAnomaly) <= Math.PI / 18 + 1e-9,
    )

    expect(nearby.length).toBeGreaterThan(3)
  })
})

describe('splitOrbitLineSegments', () => {
  it('opens a gap where an orbit line would pass through its body mesh', () => {
    const segments = splitOrbitLineSegments([
      [-3, 0, 0],
      [-1, 0, 0],
      [0, 0, 0],
      [1, 0, 0],
      [3, 0, 0],
    ], [0, 0, 0], 1.1)

    expect(segments).toEqual([
      [[-3, 0, 0], [-1.1, 0, 0]],
      [[1.1, 0, 0], [3, 0, 0]],
    ])
  })

  it('clips to the body boundary instead of dropping sparse orbit samples', () => {
    const segments = splitOrbitLineSegments([
      [-100, 0, 0],
      [0, 0, 0],
      [100, 0, 0],
    ], [0, 0, 0], 1)

    expect(segments).toEqual([
      [[-100, 0, 0], [-1, 0, 0]],
      [[1, 0, 0], [100, 0, 0]],
    ])
  })

  it('keeps uninterrupted orbit lines away from the body mesh', () => {
    const points: [number, number, number][] = [
      [3, 0, 0],
      [4, 0, 0],
      [5, 0, 0],
    ]

    expect(splitOrbitLineSegments(points, [0, 0, 0], 1)).toEqual([points])
  })
})
