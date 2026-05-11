import { describe, expect, it } from 'vitest'
import {
  MAIN_THRUST_ACCELERATION,
  RCS_ANGULAR_RATE,
  angularVelocityForRcsKeys,
  shouldStabilizeAngularVelocityForWarp,
  thrustAccelerationForOrientation,
} from '../vehicle/controls'

describe('angularVelocityForRcsKeys', () => {
  it('maps pitch, yaw, and roll keys to predictable angular velocity', () => {
    expect(angularVelocityForRcsKeys(new Set(['w', 'd', 'q']))).toEqual([
      RCS_ANGULAR_RATE,
      RCS_ANGULAR_RATE,
      -RCS_ANGULAR_RATE,
    ])
  })

  it('cancels opposite keys to zero on each axis', () => {
    expect(angularVelocityForRcsKeys(new Set(['w', 's', 'a', 'd', 'q', 'e']))).toEqual([0, 0, 0])
  })
})

describe('shouldStabilizeAngularVelocityForWarp', () => {
  it('zeros angular velocity above real time warp', () => {
    expect(shouldStabilizeAngularVelocityForWarp(1)).toBe(false)
    expect(shouldStabilizeAngularVelocityForWarp(10)).toBe(true)
  })
})

describe('thrustAccelerationForOrientation', () => {
  it('uses a visible test-flight acceleration for orbit shaping', () => {
    expect(MAIN_THRUST_ACCELERATION).toBeGreaterThanOrEqual(20)
  })

  it('returns zero acceleration with zero throttle', () => {
    expect(thrustAccelerationForOrientation([0, 0, 0, 1], 0)).toEqual([0, 0, 0])
  })

  it('applies constant forward acceleration for identity orientation', () => {
    expect(thrustAccelerationForOrientation([0, 0, 0, 1], 1)).toEqual([
      0,
      0,
      MAIN_THRUST_ACCELERATION,
    ])
  })

  it('changes vehicle speed by acceleration times elapsed time', () => {
    const velocity = [0, 0, 100] as [number, number, number]
    const acceleration = thrustAccelerationForOrientation([0, 0, 0, 1], 1)
    const elapsedSeconds = 10

    const finalVelocity = [
      velocity[0] + acceleration[0] * elapsedSeconds,
      velocity[1] + acceleration[1] * elapsedSeconds,
      velocity[2] + acceleration[2] * elapsedSeconds,
    ]

    expect(finalVelocity[2]).toBe(100 + MAIN_THRUST_ACCELERATION * elapsedSeconds)
  })
})
