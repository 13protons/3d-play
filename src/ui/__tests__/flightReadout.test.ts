import { describe, expect, it } from 'vitest'
import { computeFlightReadout, flightTelemetryRows, formatFlightNumber } from '../flightReadout'

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

  it('uses reference velocity when provided for surface-relative speed', () => {
    const readout = computeFlightReadout({
      vehiclePosition: [7_000_000, 0, 0],
      vehicleVelocity: [0, 0, 37_500],
      parentPosition: [0, 0, 0],
      parentVelocity: [0, 0, 30_000],
      parentRadius: 6_371_000,
      referenceVelocity: [100, 0, 425],
    })

    expect(readout.speed).toBeCloseTo(436.6, 1)
    expect(readout.radialSpeed).toBeCloseTo(100)
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

  it('clamps tiny signed values to zero', () => {
    expect(formatFlightNumber(-0.0001, 'm/s')).toBe('0 m/s')
    expect(formatFlightNumber(-0.0001, 'm')).toBe('0 m')
  })
})

describe('flightTelemetryRows', () => {
  const baseRowsInput = {
    readout: {
      altitude: 400_000,
      speed: 7_650,
      radialSpeed: -12,
    },
    throttle: 1,
    angularVelocity: [0.25, -0.5, 0] as [number, number, number],
    surfaceState: 'flying' as const,
  }

  it('formats vehicle telemetry for the navball panel without acceleration', () => {
    const rows = flightTelemetryRows({
      readout: {
        altitude: 400_000,
        speed: 7_650,
        radialSpeed: -12,
      },
      throttle: 1,
      angularVelocity: [0.25, -0.5, 0],
      surfaceState: 'landed',
      autopilotMode: 'damp',
      mass: 9000,
      maxThrust: 300000,
    })

    expect(rows).toEqual([
      { label: 'ALT', value: '400.0 km' },
      { label: 'VEL', value: '7.7 km/s' },
      { label: 'VERT', value: '-12 m/s' },
      { label: 'MASS', value: '9000 kg' },
    ])
    expect(rows.map((row) => row.label)).not.toContain('ACC')
    expect(rows.map((row) => row.label)).not.toContain('RATE')
    expect(rows.map((row) => row.label)).not.toContain('STATE')
    expect(rows.map((row) => row.label)).not.toContain('THR')
    expect(rows.map((row) => row.label)).not.toContain('FORCE')
    expect(rows.map((row) => row.label)).not.toContain('MODE')
  })

  it('formats closed orbit summary rows', () => {
    const rows = flightTelemetryRows({
      ...baseRowsInput,
      orbit: {
        kind: 'closed',
        periapsisAltitude: 100_000,
        apoapsisAltitude: 250_000,
      },
    })

    expect(rows.slice(-3)).toEqual([
      { label: 'ORB', value: 'CLOSED' },
      { label: 'PE', value: '100.0 km' },
      { label: 'AP', value: '250.0 km' },
    ])
  })

  it('formats open orbit summary rows with unavailable apoapsis', () => {
    const rows = flightTelemetryRows({
      ...baseRowsInput,
      orbit: {
        kind: 'open',
        periapsisAltitude: 125_000,
        apoapsisAltitude: null,
      },
    })

    expect(rows.slice(-3)).toEqual([
      { label: 'ORB', value: 'OPEN' },
      { label: 'PE', value: '125.0 km' },
      { label: 'AP', value: '--' },
    ])
  })

  it('formats impacting orbit summary as impact', () => {
    const rows = flightTelemetryRows({
      ...baseRowsInput,
      orbit: {
        kind: 'impacting',
        periapsisAltitude: -5_000,
        apoapsisAltitude: 250_000,
      },
    })

    expect(rows.slice(-3)).toEqual([
      { label: 'ORB', value: 'IMPACT' },
      { label: 'PE', value: '-5000 m' },
      { label: 'AP', value: '250.0 km' },
    ])
  })
})
