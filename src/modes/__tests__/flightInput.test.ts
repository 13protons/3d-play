import { describe, expect, it } from 'vitest'
import { throttleDirectionForKeyDown, throttleDirectionForKeyUp } from '../flightInput'

describe('throttleDirectionForKeyDown', () => {
  it('starts throttle-up for plain Shift', () => {
    expect(throttleDirectionForKeyDown(0, { key: 'Shift' })).toBe(1)
  })

  it('ignores screenshot-style system shortcuts using Shift', () => {
    expect(throttleDirectionForKeyDown(0, { key: 'Shift', metaKey: true })).toBe(0)
  })

  it('starts throttle-down for plain Control', () => {
    expect(throttleDirectionForKeyDown(0, { key: 'Control' })).toBe(-1)
  })
})

describe('throttleDirectionForKeyUp', () => {
  it('stops throttle-up when Shift is released', () => {
    expect(throttleDirectionForKeyUp(1, { key: 'Shift' })).toBe(0)
  })

  it('does not clear throttle-down when Shift is released', () => {
    expect(throttleDirectionForKeyUp(-1, { key: 'Shift' })).toBe(-1)
  })

  it('stops throttle-down when Control is released', () => {
    expect(throttleDirectionForKeyUp(-1, { key: 'Control' })).toBe(0)
  })
})
