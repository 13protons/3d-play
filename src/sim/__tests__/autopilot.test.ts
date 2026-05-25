import { describe, expect, it } from 'vitest'
import { computeAttitudeTarget, type AutopilotInput } from '../autopilot'

const earthRadius = 6_371_000
const earthGm = 3.98600435436e14

function circularOrbitInput(): AutopilotInput {
  const r = earthRadius + 100_000
  return {
    relativePosition: [r, 0, 0],
    relativeVelocity: [0, 0, Math.sqrt(earthGm / r)],
    parentRadius: earthRadius,
    parentGm: earthGm,
    parentAngularVelocity: 0,
    parentRotationAxis: [0, 1, 0],
    surfaceState: 'flying',
  }
}

describe('computeAttitudeTarget', () => {
  it('returns manual for off mode', () => {
    expect(computeAttitudeTarget('off', circularOrbitInput())).toEqual({ kind: 'manual' })
  })

  it('returns damp for damp mode', () => {
    expect(computeAttitudeTarget('damp', circularOrbitInput())).toEqual({ kind: 'damp' })
  })

  it('seeks prograde along velocity', () => {
    const target = computeAttitudeTarget('prograde', circularOrbitInput())
    expect(target.kind).toBe('seek-forward')
    if (target.kind !== 'seek-forward') return
    expect(target.vector[0]).toBeCloseTo(0)
    expect(target.vector[2]).toBeCloseTo(1)
  })

  it('seeks retrograde opposite velocity', () => {
    const target = computeAttitudeTarget('retrograde', circularOrbitInput())
    expect(target.kind).toBe('seek-forward')
    if (target.kind !== 'seek-forward') return
    expect(target.vector[2]).toBeCloseTo(-1)
  })

  it('seeks normal perpendicular to orbit plane', () => {
    const target = computeAttitudeTarget('normal', circularOrbitInput())
    expect(target.kind).toBe('seek-forward')
    if (target.kind !== 'seek-forward') return
    expect(target.vector[1]).toBeCloseTo(-1)
  })

  it('seeks antinormal opposite the orbit normal', () => {
    const target = computeAttitudeTarget('antinormal', circularOrbitInput())
    expect(target.kind).toBe('seek-forward')
    if (target.kind !== 'seek-forward') return
    expect(target.vector[1]).toBeCloseTo(1)
  })

  it('seeks radial-out away from parent', () => {
    const target = computeAttitudeTarget('radial-out', circularOrbitInput())
    expect(target.kind).toBe('seek-forward')
    if (target.kind !== 'seek-forward') return
    expect(target.vector[0]).toBeCloseTo(1)
  })

  it('seeks radial-in toward parent', () => {
    const target = computeAttitudeTarget('radial-in', circularOrbitInput())
    expect(target.kind).toBe('seek-forward')
    if (target.kind !== 'seek-forward') return
    expect(target.vector[0]).toBeCloseTo(-1)
  })

  it('uses surface velocity for prograde when in surface mode', () => {
    const target = computeAttitudeTarget('prograde', {
      relativePosition: [earthRadius, 0, 0],
      relativeVelocity: [0, 0, 0],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 1,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'landed',
    })
    // omega x r = (0,1,0) x (R,0,0) = (0,0,-R), nav vel - rotation = (0,0,R) - (0,0,-R) = (0,0,0)
    // surfaceVelocity = relativeVelocity - cross(omega*axis, r) = (0,0,0) - (0,0,-R) = (0,0,R)
    expect(target.kind).toBe('seek-forward')
    if (target.kind !== 'seek-forward') return
    expect(target.vector[2]).toBeCloseTo(1)
  })

  it('falls back to damp when prograde velocity is zero', () => {
    const target = computeAttitudeTarget('prograde', {
      relativePosition: [earthRadius + 100_000, 0, 0],
      relativeVelocity: [0, 0, 0],
      parentRadius: earthRadius,
      parentGm: earthGm,
      parentAngularVelocity: 0,
      parentRotationAxis: [0, 1, 0],
      surfaceState: 'flying',
    })
    expect(target).toEqual({ kind: 'damp' })
  })
})
