import { describe, expect, it } from 'vitest'
import {
  REACTION_WHEEL_ANGULAR_RATE,
  adjustThrottle,
  angularVelocityAfterTorque,
  angularVelocityDampingTorque,
  attitudeHoldTorque,
  forwardDirectionHoldTorque,
  manualReactionWheelTorque,
  rotateOrientationAroundWorldAxis,
  pidStep,
  angularVelocityForReactionWheelKeys,
  reactionWheelTorqueForKeys,
  sumAndClampTorque,
  shouldEmitAeroForce,
  shouldDisableThrottleForWarp,
  shouldStabilizeAngularVelocityForWarp,
  thrustAccelerationForElapsedRotation,
  thrustAccelerationForOrientation,
  throttleCut,
  throttleFull,
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

describe('reactionWheelTorqueForKeys', () => {
  const torque: [number, number, number] = [10, 20, 30]

  it('maps pitch, yaw, and roll keys to configured torque', () => {
    expect(reactionWheelTorqueForKeys(new Set(['w', 'd', 'q']), torque)).toEqual([10, 20, -30])
  })

  it('cancels opposite keys to zero torque on each axis', () => {
    expect(reactionWheelTorqueForKeys(new Set(['w', 's', 'a', 'd', 'q', 'e']), torque)).toEqual([0, 0, 0])
  })
})

describe('angularVelocityAfterTorque', () => {
  it('integrates torque over moment of inertia', () => {
    expect(angularVelocityAfterTorque([0, 0, 0], [10, 0, 0], [5, 5, 5], 2)).toEqual([4, 0, 0])
  })
})

describe('manualReactionWheelTorque', () => {
  it('passes through manual command torque without adding release braking', () => {
    const torque = manualReactionWheelTorque({
      commandTorque: [400_000, 0, -250_000],
      angularVelocity: [1, -1, 0.5],
    })

    expect(torque).toEqual([400_000, 0, -250_000])
  })

  it('does not autobrake when manual input is released', () => {
    const torque = manualReactionWheelTorque({
      commandTorque: [0, 0, 0],
      angularVelocity: [1, -1, 0.5],
    })

    expect(torque).toEqual([0, 0, 0])
  })
})

describe('sumAndClampTorque', () => {
  it('combines manual and autopilot torque while respecting wheel limits', () => {
    expect(sumAndClampTorque([300, -300, 50], [300, -300, -100], [400, 400, 100])).toEqual([400, -400, -50])
  })
})

describe('attitudeHoldTorque', () => {
  const maxTorque: [number, number, number] = [10, 10, 10]

  it('returns less torque as orientation error decreases', () => {
    const large = attitudeHoldTorque({
      currentOrientation: [0, 0, 0, 1],
      targetOrientation: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)],
      angularVelocity: [0, 0, 0],
      maxTorque,
    })
    const small = attitudeHoldTorque({
      currentOrientation: [0, 0, 0, 1],
      targetOrientation: [0, Math.sin(Math.PI / 16), 0, Math.cos(Math.PI / 16)],
      angularVelocity: [0, 0, 0],
      maxTorque,
    })

    expect(Math.abs(small[1])).toBeLessThan(Math.abs(large[1]))
  })

  it('damps against angular velocity to avoid endless precession', () => {
    const torque = attitudeHoldTorque({
      currentOrientation: [0, 0, 0, 1],
      targetOrientation: [0, Math.sin(Math.PI / 16), 0, Math.cos(Math.PI / 16)],
      angularVelocity: [0, 1, 0],
      maxTorque,
    })

    expect(torque[1]).toBeLessThan(0)
  })

  it('computes orientation error in craft-local axes', () => {
    const halfTurn = Math.PI / 4
    const torque = attitudeHoldTorque({
      currentOrientation: [0, Math.sin(halfTurn), 0, Math.cos(halfTurn)],
      targetOrientation: [Math.sin(halfTurn), 0, 0, Math.cos(halfTurn)],
      angularVelocity: [0, 0, 0],
      maxTorque,
    })

    expect(torque[0]).toBeGreaterThan(0)
    expect(torque[1]).toBeLessThan(0)
    expect(torque[2]).toBeGreaterThan(0)
  })

  it('scales damping by moment of inertia so attitude hold brakes before overshooting', () => {
    const torque = attitudeHoldTorque({
      currentOrientation: [0, 0, 0, 1],
      targetOrientation: [0, Math.sin(Math.PI / 16), 0, Math.cos(Math.PI / 16)],
      angularVelocity: [0, 1, 0],
      maxTorque: [800_000, 800_000, 500_000],
      momentOfInertia: [12_000, 12_000, 8_000],
    })

    expect(torque[1]).toBeLessThan(-10_000)
  })
})

describe('angularVelocityDampingTorque', () => {
  it('damps angular velocity without using attitude error', () => {
    const torque = angularVelocityDampingTorque({
      angularVelocity: [1, -0.5, 0.25],
      maxTorque: [400_000, 400_000, 250_000],
      momentOfInertia: [12_000, 12_000, 8_000],
    })

    expect(torque[0]).toBeLessThan(0)
    expect(torque[1]).toBeGreaterThan(0)
    expect(torque[2]).toBeLessThan(0)
  })

  it('returns no torque when angular velocity is zero', () => {
    expect(angularVelocityDampingTorque({
      angularVelocity: [0, 0, 0],
      maxTorque: [400_000, 400_000, 250_000],
      momentOfInertia: [12_000, 12_000, 8_000],
    })).toEqual([0, 0, 0])
  })
})

describe('forwardDirectionHoldTorque', () => {
  it('does not seek a fixed roll when forward is already aligned', () => {
    const halfRoll = Math.PI / 4
    const torque = forwardDirectionHoldTorque({
      currentOrientation: [0, 0, Math.sin(halfRoll), Math.cos(halfRoll)],
      targetForward: [0, 0, 1],
      angularVelocity: [0, 0, 0],
      maxTorque: [400_000, 400_000, 250_000],
      momentOfInertia: [12_000, 12_000, 8_000],
    })

    expect(torque).toEqual([0, 0, 0])
  })

  it('uses pitch and yaw torque to align forward direction', () => {
    const torque = forwardDirectionHoldTorque({
      currentOrientation: [0, 0, 0, 1],
      targetForward: [1, 0, 0],
      angularVelocity: [0, 0, 0],
      maxTorque: [400_000, 400_000, 250_000],
      momentOfInertia: [12_000, 12_000, 8_000],
    })

    expect(torque[0]).toBe(0)
    expect(torque[1]).toBeGreaterThan(0)
    expect(torque[2]).toBe(0)
  })

  it('still produces torque when target is exactly opposite to current forward', () => {
    // Identity orientation -> vehicle forward is +z. Asking for -z is a 180° flip;
    // a bare cross-product error would be zero here.
    const torque = forwardDirectionHoldTorque({
      currentOrientation: [0, 0, 0, 1],
      targetForward: [0, 0, -1],
      angularVelocity: [0, 0, 0],
      maxTorque: [400_000, 400_000, 250_000],
      momentOfInertia: [12_000, 12_000, 8_000],
    })

    const magnitude = Math.hypot(torque[0], torque[1], torque[2])
    expect(magnitude).toBeGreaterThan(0)
  })
})

describe('rotateOrientationAroundWorldAxis', () => {
  it('is a no-op for a zero angle', () => {
    const q: [number, number, number, number] = [0, 0, 0, 1]
    expect(rotateOrientationAroundWorldAxis(q, [0, 1, 0], 0)).toEqual(q)
  })

  it('rotates the identity orientation around the world Y axis by 90 degrees', () => {
    const result = rotateOrientationAroundWorldAxis([0, 0, 0, 1], [0, 1, 0], Math.PI / 2)
    // Quaternion for 90deg around +Y: (0, sin(45deg), 0, cos(45deg))
    expect(result[0]).toBeCloseTo(0)
    expect(result[1]).toBeCloseTo(Math.SQRT1_2)
    expect(result[2]).toBeCloseTo(0)
    expect(result[3]).toBeCloseTo(Math.SQRT1_2)
  })

  it('composes a body-frame rotation with a world-frame drag from the parent', () => {
    // Start tilted 90deg around +X (body now points "up" if it started "forward").
    const half = Math.PI / 4
    const tilted: [number, number, number, number] = [Math.sin(half), 0, 0, Math.cos(half)]
    // Drag the world frame 180deg around +Y. World-axis rotation pre-multiplies,
    // so the tilt should still be visible in the result (composed, not lost).
    const result = rotateOrientationAroundWorldAxis(tilted, [0, 1, 0], Math.PI)
    const magnitude = Math.hypot(...result)
    expect(magnitude).toBeCloseTo(1)
    // q.w for a 90deg rotation has magnitude cos(45deg); composition of two pure
    // rotations of 90deg and 180deg leaves w = 0 (orthogonal rotations).
    expect(result[3]).toBeCloseTo(0)
  })
})

describe('pidStep', () => {
  it('combines proportional, integral, and derivative terms with output clamp', () => {
    expect(pidStep({
      error: 2,
      integral: 1,
      derivative: -0.5,
      kp: 3,
      ki: 2,
      kd: 4,
      maxOutput: 5,
    })).toBe(5)
  })

  it('supports derivative damping without integral', () => {
    expect(pidStep({
      error: 0.2,
      integral: 0,
      derivative: -1,
      kp: 8,
      ki: 0,
      kd: 10,
      maxOutput: 10,
    })).toBeLessThan(0)
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

describe('throttle controls', () => {
  it('ramps throttle by elapsed wall-clock time', () => {
    expect(adjustThrottle(0.25, 1, 0.5)).toBe(0.5)
    expect(adjustThrottle(0.25, -1, 0.5)).toBe(0)
  })

  it('clamps throttle ramp to valid range', () => {
    expect(adjustThrottle(0.9, 1, 1)).toBe(1)
    expect(adjustThrottle(0.1, -1, 1)).toBe(0)
  })

  it('sets full and cut throttle directly', () => {
    expect(throttleFull()).toBe(1)
    expect(throttleCut()).toBe(0)
  })
})

describe('thrustAccelerationForOrientation', () => {
  it('returns zero acceleration with zero throttle', () => {
    expect(thrustAccelerationForOrientation([0, 0, 0, 1], 0, { maxThrust: 300_000, mass: 10_000 })).toEqual([0, 0, 0])
  })

  it('returns zero acceleration without engine data', () => {
    expect(thrustAccelerationForOrientation([0, 0, 0, 1], 1)).toEqual([0, 0, 0])
  })

  it('uses max thrust divided by mass for identity orientation', () => {
    expect(thrustAccelerationForOrientation([0, 0, 0, 1], 1, { maxThrust: 300_000, mass: 10_000 })).toEqual([
      0,
      0,
      30,
    ])
  })

  it('scales thrust by throttle', () => {
    expect(thrustAccelerationForOrientation([0, 0, 0, 1], 0.5, { maxThrust: 300_000, mass: 10_000 })).toEqual([
      0,
      0,
      15,
    ])
  })

  it('rotates thrust with vehicle yaw orientation', () => {
    const halfAngle = Math.PI / 4

    expect(thrustAccelerationForOrientation([0, Math.sin(halfAngle), 0, Math.cos(halfAngle)], 1, { maxThrust: 300_000, mass: 10_000 })).toEqual([
      30,
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
      { maxThrust: 300_000, mass: 10_000 },
    )

    expect(acceleration).toEqual([
      30,
      0,
      expect.closeTo(0, 10),
    ])
  })

  it('changes vehicle speed by acceleration times elapsed time', () => {
    const velocity = [0, 0, 100] as [number, number, number]
    const acceleration = thrustAccelerationForOrientation([0, 0, 0, 1], 1, { maxThrust: 300_000, mass: 10_000 })
    const elapsedSeconds = 10

    const finalVelocity = [
      velocity[0] + acceleration[0] * elapsedSeconds,
      velocity[1] + acceleration[1] * elapsedSeconds,
      velocity[2] + acceleration[2] * elapsedSeconds,
    ]

    expect(finalVelocity[2]).toBe(100 + 30 * elapsedSeconds)
  })
})
