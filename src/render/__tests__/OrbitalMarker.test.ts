import { describe, expect, it } from 'vitest'
import { markerStyleForBody } from '../markerStyle'

describe('markerStyleForBody', () => {
  it('uses saturated feature colors for planet sprites', () => {
    expect(markerStyleForBody('venus', '#d8b26e')).toMatchObject({
      fill: '#f4c85a',
      outline: '#8f6f22',
    })
    expect(markerStyleForBody('mars', '#c65f3a')).toMatchObject({
      fill: '#d75a32',
      outline: '#78311c',
    })
    expect(markerStyleForBody('jupiter', '#d2b48c')).toMatchObject({
      fill: '#d98b45',
      outline: '#74401d',
    })
  })

  it('adds a ring glyph for Saturn sprites', () => {
    expect(markerStyleForBody('saturn', '#c8b27a')).toEqual({
      fill: '#d6b36a',
      outline: '#766033',
      outlineWidth: 2,
      ring: true,
      ringColor: 'rgba(232,211,160,0.95)',
    })
  })
})
