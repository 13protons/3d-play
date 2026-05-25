import { describe, expect, it } from 'vitest'
import {
  nextPauseMenuStateForEscape,
  shouldProcessFlightControlKey,
} from '../flightPause'

describe('flight pause controls', () => {
  it('toggles the pause menu with Escape', () => {
    expect(nextPauseMenuStateForEscape(false)).toBe(true)
    expect(nextPauseMenuStateForEscape(true)).toBe(false)
  })

  it('ignores normal flight controls while paused', () => {
    expect(shouldProcessFlightControlKey({ paused: true, key: 'w' })).toBe(false)
    expect(shouldProcessFlightControlKey({ paused: true, key: ']' })).toBe(false)
    expect(shouldProcessFlightControlKey({ paused: true, key: 'Escape' })).toBe(true)
  })

  it('allows normal flight controls while unpaused', () => {
    expect(shouldProcessFlightControlKey({ paused: false, key: 'w' })).toBe(true)
    expect(shouldProcessFlightControlKey({ paused: false, key: ']' })).toBe(true)
  })
})
