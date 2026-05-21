import { describe, expect, it } from 'vitest'
import { throttleDirectionForKeyDown, throttleDirectionForKeyUp, throttlePresetForKeyDown } from '../flightInput'

describe('throttleDirectionForKeyDown', () => {
  it('starts throttle-up for plain Z', () => {
    expect(throttleDirectionForKeyDown(0, { key: 'z' })).toBe(1)
  })

  it('ignores screenshot-style system shortcuts using Z', () => {
    expect(throttleDirectionForKeyDown(0, { key: 'z', metaKey: true })).toBe(0)
  })

  it('starts throttle-down for plain X', () => {
    expect(throttleDirectionForKeyDown(0, { key: 'x' })).toBe(-1)
  })

  it('does not use Shift or Control for throttle ramping', () => {
    expect(throttleDirectionForKeyDown(0, { key: 'Shift' })).toBe(0)
    expect(throttleDirectionForKeyDown(0, { key: 'Control' })).toBe(0)
  })
})

describe('throttleDirectionForKeyUp', () => {
  it('stops throttle-up when Z is released', () => {
    expect(throttleDirectionForKeyUp(1, { key: 'z' })).toBe(0)
  })

  it('does not clear throttle-down when Z is released', () => {
    expect(throttleDirectionForKeyUp(-1, { key: 'z' })).toBe(-1)
  })

  it('stops throttle-down when X is released', () => {
    expect(throttleDirectionForKeyUp(-1, { key: 'x' })).toBe(0)
  })
})

describe('throttlePresetForKeyDown', () => {
  it('maps Ctrl+Z to full throttle', () => {
    expect(throttlePresetForKeyDown({ key: 'z', ctrlKey: true })).toBe('full')
  })

  it('maps Ctrl+X to cut throttle', () => {
    expect(throttlePresetForKeyDown({ key: 'x', ctrlKey: true })).toBe('cut')
  })

  it('does not treat plain Z or X as throttle presets', () => {
    expect(throttlePresetForKeyDown({ key: 'z' })).toBe(null)
    expect(throttlePresetForKeyDown({ key: 'x' })).toBe(null)
  })
})
