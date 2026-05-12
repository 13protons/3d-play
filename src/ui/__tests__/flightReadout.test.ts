import { describe, expect, it } from 'vitest'
import { computeFlightReadout, formatFlightNumber } from '../flightReadout'

describe('computeFlightReadout', () => {
  it('computes altitude, relative speed, and radial speed from vehicle and parent states', () => {
    const readout = computeFlightReadout({
      vehiclePosition: [7_000_000, 0, 0],
      vehicleVelocity: [100, 0, 7_500],
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 0],
      parentRadius: 6_371_000,
    })

    expect(readout.altitude).toBe(629_000)
    expect(readout.speed).toBeCloseTo(7_500.6666, 3)
    expect(readout.radialSpeed).toBeCloseTo(100)
  })

  it('uses parent-relative velocity for orbital speed', () => {
    const readout = computeFlightReadout({
      vehiclePosition: [7_000_000, 0, 0],
      vehicleVelocity: [0, 0, 37_500],
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 30_000],
      parentRadius: 6_371_000,
    })

    expect(readout.speed).toBe(7_500)
  })
})

describe('formatFlightNumber', () => {
  it('formats meters and kilometers compactly', () => {
    expect(formatFlightNumber(950, 'm')).toBe('950 m')
    expect(formatFlightNumber(12_345, 'm')).toBe('12.3 km')
  })

  it('formats speed units compactly', () => {
    expect(formatFlightNumber(123.4, 'm/s')).toBe('123 m/s')
    expect(formatFlightNumber(7_543, 'm/s')).toBe('7.5 km/s')
  })
})
