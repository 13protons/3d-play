import { describe, expect, it } from 'vitest'
import { attitudeDiagnostics } from '../attitudeDiagnostics'

describe('attitudeDiagnostics', () => {
  it('returns null without reaction-wheel torque data', () => {
    expect(attitudeDiagnostics({ angularVelocity: [0, 0, 0] })).toBeNull()
  })

  it('reports per-axis commanded torque, saturation, and rate', () => {
    const rows = attitudeDiagnostics({
      commandedTorque: [4_000, -8_000, 0],
      reactionWheelTorque: [8_000, 8_000, 5_000],
      angularVelocity: [0.1, -0.2, 0],
    })

    expect(rows).not.toBeNull()
    expect(rows!.map((r) => r.label)).toEqual(['Pitch', 'Yaw', 'Roll'])
    expect(rows![0].saturation).toBeCloseTo(0.5)
    // Full negative torque on the yaw axis → saturated.
    expect(rows![1].saturation).toBeCloseTo(1)
    expect(rows![1].commanded).toBe(-8_000)
    expect(rows![2].saturation).toBe(0)
    expect(rows![0].angularRate).toBeCloseTo(0.1)
  })

  it('clamps saturation to 1 when commanded exceeds the available torque', () => {
    const rows = attitudeDiagnostics({
      commandedTorque: [12_000, 0, 0],
      reactionWheelTorque: [8_000, 8_000, 5_000],
      angularVelocity: [0, 0, 0],
    })
    expect(rows![0].saturation).toBe(1)
  })

  it('treats missing commanded torque as zero', () => {
    const rows = attitudeDiagnostics({
      reactionWheelTorque: [8_000, 8_000, 5_000],
      angularVelocity: [0, 0, 0],
    })
    expect(rows!.every((r) => r.commanded === 0 && r.saturation === 0)).toBe(true)
  })
})
