import { describe, expect, it } from 'vitest'
import {
  classifySurfaceContact,
  classifySurfaceContactAlongSegment,
  isLandingDescent,
  landedSurfaceState,
  restingContactState,
  rotatingSurfaceState,
  surfaceResponse,
} from '../vehicle/surfaceContact'

describe('isLandingDescent', () => {
  const landed = { type: 'landed' as const, surfaceNormal: [1, 0, 0] as [number, number, number] }
  const crashed = { type: 'crashed' as const, surfaceNormal: [1, 0, 0] as [number, number, number] }

  it('lands when descending toward the surface', () => {
    expect(isLandingDescent(landed, -5)).toBe(true)
    expect(isLandingDescent(crashed, -50)).toBe(true)
  })

  it('does not re-grab a craft thrusting off the pad (ascending or stationary)', () => {
    expect(isLandingDescent(landed, 5)).toBe(false) // climbing
    expect(isLandingDescent(landed, 0)).toBe(false) // just released, no radial velocity yet
  })

  it('is never a landing while flying', () => {
    expect(isLandingDescent({ type: 'flying' }, -5)).toBe(false)
  })
})

describe('surfaceResponse', () => {
  const normal = [1, 0, 0] as [number, number, number]
  const landed = { type: 'landed' as const, surfaceNormal: normal }
  const crashed = { type: 'crashed' as const, surfaceNormal: normal }

  it('keeps a craft flying when there is no contact', () => {
    expect(surfaceResponse({ type: 'flying' }, false, true)).toBe('fly')
    expect(surfaceResponse({ type: 'flying' }, true, true)).toBe('fly')
  })

  it('lets an ascending craft fly even within the contact radius (healthy-TWR climb)', () => {
    // The contact radius grows as fuel drains and the CoM rises, so a climbing craft can sit
    // "within" it — but a non-penetration force never grabs something already leaving. This is
    // the regression that pinned a TWR>1 ascent to the ground.
    expect(surfaceResponse(landed, true, false)).toBe('fly') // under power, ascending
    expect(surfaceResponse(landed, false, false)).toBe('fly') // coasting up through the radius
  })

  it('crashes on a hard contact moving into the surface, regardless of thrust', () => {
    expect(surfaceResponse(crashed, false, true)).toBe('crash')
    expect(surfaceResponse(crashed, true, true)).toBe('crash')
  })

  it('parks on a gentle touchdown when the engine is quiet', () => {
    expect(surfaceResponse(landed, false, true)).toBe('park')
  })

  it('rests (stays dynamic) when under power but sinking (sub-TWR) — no landed↔flying flicker', () => {
    // Sub-TWR throttle-up: net-down, so it's moving into the surface; it must not be re-parked or
    // it would flicker between landed and flying every step. It rests until thrust beats gravity.
    expect(surfaceResponse(landed, true, true)).toBe('rest')
  })
})

describe('restingContactState', () => {
  it('clamps to the contact radius and cancels only the inward-normal velocity, preserving tangential', () => {
    const rest = restingContactState({
      relativePosition: [9, 0, 0], // just below the surface
      relativeVelocity: [-5, 3, 0], // -5 into the surface, +3 tangential
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 0],
      contactRadius: 10,
    })
    expect(rest.position).toEqual([10, 0, 0]) // clamped out to the radius
    expect(rest.velocity).toEqual([0, 3, 0]) // inward cancelled, tangential kept → slides on a slope
  })

  it('leaves an outward (ascending) velocity untouched so the craft lifts off once TWR > 1', () => {
    const rest = restingContactState({
      relativePosition: [9, 0, 0],
      relativeVelocity: [5, 0, 0], // moving outward
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 0],
      contactRadius: 10,
    })
    expect(rest.velocity).toEqual([5, 0, 0])
  })

  it('adds the parent position and velocity (resting in the parent frame)', () => {
    const rest = restingContactState({
      relativePosition: [9, 0, 0],
      relativeVelocity: [-5, 0, 0],
      parentPosition: [100, 0, 0],
      parentVelocity: [1, 2, 3],
      contactRadius: 10,
    })
    expect(rest.position).toEqual([110, 0, 0])
    expect(rest.velocity).toEqual([1, 2, 3])
  })
})

describe('classifySurfaceContact', () => {
  it('does nothing above the surface', () => {
    expect(classifySurfaceContact({
      relativePosition: [11, 0, 0],
      relativeVelocity: [-100, 0, 0],
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'flying' })
  })

  it('lands at low inward radial speed', () => {
    expect(classifySurfaceContact({
      relativePosition: [9, 0, 0],
      relativeVelocity: [-5, 0, 0],
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'landed', surfaceNormal: [1, 0, 0] })
  })

  it('lands when initialized exactly on the surface without radial speed', () => {
    expect(classifySurfaceContact({
      relativePosition: [-10, 0, 0],
      relativeVelocity: [0, 0, 0],
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'landed', surfaceNormal: [-1, 0, 0] })
  })

  it('crashes at high inward radial speed', () => {
    expect(classifySurfaceContact({
      relativePosition: [9, 0, 0],
      relativeVelocity: [-25, 0, 0],
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'crashed', surfaceNormal: [1, 0, 0] })
  })
})

describe('classifySurfaceContactAlongSegment', () => {
  it('catches high-speed crossings that start and end outside the body', () => {
    expect(classifySurfaceContactAlongSegment({
      previousRelativePosition: [20, 0, 0],
      currentRelativePosition: [-20, 0, 0],
      relativeVelocity: [-100, 0, 0],
      elapsedSeconds: 1,
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'crashed', surfaceNormal: [1, 0, 0], segmentT: 0.25 })
  })

  it('does not re-land a vehicle lifting off from the surface', () => {
    expect(classifySurfaceContactAlongSegment({
      previousRelativePosition: [10, 0, 0],
      currentRelativePosition: [11, 0, 0],
      relativeVelocity: [5, 0, 0],
      elapsedSeconds: 1,
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'flying' })
  })

  it('uses segment direction for crossing speed instead of endpoint velocity', () => {
    expect(classifySurfaceContactAlongSegment({
      previousRelativePosition: [20, 0, 0],
      currentRelativePosition: [5, 0, 0],
      relativeVelocity: [100, 0, 0],
      elapsedSeconds: 1,
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'crashed', surfaceNormal: [1, 0, 0], segmentT: 2 / 3 })
  })

  it('keeps inward contact that starts exactly on the surface', () => {
    expect(classifySurfaceContactAlongSegment({
      previousRelativePosition: [10, 0, 0],
      currentRelativePosition: [9, 0, 0],
      relativeVelocity: [-100, 0, 0],
      elapsedSeconds: 1,
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'crashed', surfaceNormal: [1, 0, 0], segmentT: 0 })
  })

  it('classifies far-side endpoint penetration using the crossing normal', () => {
    expect(classifySurfaceContactAlongSegment({
      previousRelativePosition: [20, 0, 0],
      currentRelativePosition: [-5, 0, 0],
      relativeVelocity: [-100, 0, 0],
      elapsedSeconds: 1,
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })).toEqual({ type: 'crashed', surfaceNormal: [1, 0, 0], segmentT: 0.4 })
  })

  it('uses the actual crossing normal for oblique impacts', () => {
    const contact = classifySurfaceContactAlongSegment({
      previousRelativePosition: [20, 0, 0],
      currentRelativePosition: [0, 0, 5],
      relativeVelocity: [-20, 0, 5],
      elapsedSeconds: 1,
      parentRadius: 10,
      landingSpeedThreshold: 10,
    })

    expect(contact.type).toBe('crashed')
    if (contact.type !== 'flying') {
      expect(Math.hypot(...contact.surfaceNormal)).toBeCloseTo(1)
      expect(contact.surfaceNormal[0]).toBeGreaterThan(0)
      expect(contact.surfaceNormal[2]).toBeGreaterThan(0)
    }
  })
})

describe('landedSurfaceState', () => {
  it('clamps vehicle to the parent surface and matches surface velocity', () => {
    expect(landedSurfaceState({
      parentPosition: [100, 0, 0],
      parentVelocity: [1, 2, 3],
      parentRadius: 10,
      surfaceNormal: [1, 0, 0],
      parentAngularVelocity: 2,
      parentRotationAxis: [0, 1, 0],
    })).toEqual({
      position: [110, 0, 0],
      velocity: [1, 2, -17],
    })
  })
})

describe('rotatingSurfaceState', () => {
  it('rotates the landed surface normal with parent spin', () => {
    const state = rotatingSurfaceState({
      landedAt: 0,
      simTime: Math.PI / 2,
      initialSurfaceNormal: [1, 0, 0],
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 0],
      parentRadius: 10,
      parentAngularVelocity: 1,
      parentRotationAxis: [0, 1, 0],
    })

    expect(state.position[0]).toBeCloseTo(0)
    expect(state.position[2]).toBeCloseTo(-10)
    expect(state.velocity[0]).toBeCloseTo(-10)
    expect(state.velocity[2]).toBeCloseTo(0)
  })

  it('can rotate around a tilted parent spin axis', () => {
    const state = rotatingSurfaceState({
      landedAt: 0,
      simTime: Math.PI / 2,
      initialSurfaceNormal: [1, 0, 0],
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 0],
      parentRadius: 10,
      parentAngularVelocity: 1,
      parentRotationAxis: [0, 0, 1],
    })

    expect(state.position[0]).toBeCloseTo(0)
    expect(state.position[1]).toBeCloseTo(10)
    expect(state.position[2]).toBeCloseTo(0)
  })
})
