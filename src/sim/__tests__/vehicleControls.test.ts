import { describe, expect, it } from 'vitest'
import {
  MAIN_THRUST_ACCELERATION,
  REACTION_WHEEL_ANGULAR_RATE,
  angularVelocityForReactionWheelKeys,
  shouldEmitAeroForce,
  shouldDisableThrottleForWarp,
  shouldStabilizeAngularVelocityForWarp,
  thrustAccelerationForElapsedRotation,
  thrustAccelerationForOrientation,
  toggleThrottle,
} from '../vehicle/controls'

describe('angularVelocityForReactionWheelKeys', () => {
  it('uses a responsive rate for visible attitude changes', () => {
    expect(REACTION_WHEEL_ANGULAR_RATE).toBeGreaterThanOrEqual(0.2)
  })

  it('maps pitch, yaw, and roll keys to predictable angular velocity', () => {
    expect(angularVelocityForReactionWheelKeys(new Set(['w', 'd', 'q']))).toEqual([
      REACTION_WHEEL_ANGULAR_RATE,
      REACTION_WHEEL_ANGULAR_RATE,
      -REACTION_WHEEL_ANGULAR_RATE,
    ])
  })

  it('cancels opposite keys to zero on each axis', () => {
    expect(angularVelocityForReactionWheelKeys(new Set(['w', 's', 'a', 'd', 'q', 'e']))).toEqual([0, 0, 0])
  })
})

describe('shouldStabilizeAngularVelocityForWarp', () => {
  it('zeros angular velocity above real time warp', () => {
    expect(shouldStabilizeAngularVelocityForWarp(1)).toBe(false)
    expect(shouldStabilizeAngularVelocityForWarp(10)).toBe(true)
  })
})

describe('shouldDisableThrottleForWarp', () => {
  it('shuts off engine thrust above real time warp', () => {
    expect(shouldDisableThrottleForWarp(1)).toBe(false)
    expect(shouldDisableThrottleForWarp(10)).toBe(true)
  })
})

describe('shouldEmitAeroForce', () => {
  it('emits only finite nonzero aero force vectors', () => {
    expect(shouldEmitAeroForce([0, 0, 0])).toBe(false)
    expect(shouldEmitAeroForce([1, 0, 0])).toBe(true)
    expect(shouldEmitAeroForce([Number.NaN, 0, 0])).toBe(false)
  })
})

describe('toggleThrottle', () => {
  it('toggles main thrust between off and full throttle', () => {
    expect(toggleThrottle(0)).toBe(1)
    expect(toggleThrottle(1)).toBe(0)
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

  it('rotates thrust with vehicle yaw orientation', () => {
    const halfAngle = Math.PI / 4

    expect(thrustAccelerationForOrientation([0, Math.sin(halfAngle), 0, Math.cos(halfAngle)], 1)).toEqual([
      MAIN_THRUST_ACCELERATION,
      0,
      expect.closeTo(0, 10),
    ])
  })

  it('updates thrust direction during elapsed reaction wheel rotation', () => {
    const acceleration = thrustAccelerationForElapsedRotation(
      [0, 0, 0, 1],
      [0, Math.PI / 2, 0],
      1,
      1,
    )

    expect(acceleration).toEqual([
      MAIN_THRUST_ACCELERATION,
      0,
      expect.closeTo(0, 10),
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
