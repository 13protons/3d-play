import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Navball, NavballInstrument } from '../Navball'
import { computeArcProgressPath, computeForceLoadRatio } from '../navballInstrumentMath'

const navballProps = {
  orientation: [0, 0, 0, 1] as [number, number, number, number],
  relativePosition: [1, 0, 0] as [number, number, number],
  relativeVelocity: [0, 0, 1] as [number, number, number],
  parentRotationAxis: [0, 1, 0] as [number, number, number],
  mode: 'orbital' as const,
}

describe('computeArcProgressPath', () => {
  it('computes mirrored and unmirrored arc progress paths', () => {
    const right = computeArcProgressPath({ value: 0.2, radius: 90, cx: 95, cy: 90, startDegrees: 135, endDegrees: 45 })
    const left = computeArcProgressPath({ value: 0.4, radius: 90, cx: 95, cy: 90, startDegrees: 135, endDegrees: 45, mirror: true })

    expect(right.trackPath).toContain('A 90 90 0 0 0')
    expect(right.progressPath).not.toBe(right.trackPath)
    expect(left.trackPath).toContain('A 90 90 0 0 1')
    expect(left.progressPath).not.toBe(right.progressPath)
  })

  it('matches the static navball frame arc coordinates', () => {
    const right = computeArcProgressPath({ value: 0.5, radius: 90, cx: 95, cy: 90, startDegrees: 135, endDegrees: 45 })
    const left = computeArcProgressPath({ value: 0, radius: 90, cx: 95, cy: 90, startDegrees: 135, endDegrees: 45, mirror: true })

    expect(right.trackPath).toBe('M 159 154 A 90 90 0 0 0 159 26')
    expect(right.progressPath).toBe('M 159 154 A 90 90 0 0 0 185 90')
    expect(left.trackPath).toBe('M 31 154 A 90 90 0 0 1 31 26')
  })
})

describe('computeForceLoadRatio', () => {
  it('normalizes thrust load against a 10g force gauge', () => {
    expect(computeForceLoadRatio({ currentThrust: 300_000, mass: 9_000 })).toBeCloseTo(0.34, 2)
  })

  it('includes aerodynamic force load even without thrust', () => {
    expect(computeForceLoadRatio({ currentThrust: 0, aeroForceWorld: [0, 441_299.25, 0], mass: 9_000 })).toBeCloseTo(0.5)
  })

  it('adds thrust and aero load magnitudes and clamps the gauge', () => {
    expect(computeForceLoadRatio({ currentThrust: 900_000, aeroForceWorld: [900_000, 0, 0], mass: 9_000 })).toBe(1)
  })

  it('returns zero when mass is missing or invalid', () => {
    expect(computeForceLoadRatio({ currentThrust: 300_000 })).toBe(0)
    expect(computeForceLoadRatio({ currentThrust: 300_000, mass: 0 })).toBe(0)
  })
})

describe('NavballInstrument', () => {
  it('renders regime/orbit/state shelves and arc progress bars', () => {
    const markup = renderToStaticMarkup(
      <NavballInstrument
        {...navballProps}
        throttle={0.62}
        forceRatio={0.18}
        surfaceState="flying"
        autopilotMode="damp"
        orbit={{ kind: 'closed', periapsisAltitude: 100_000, apoapsisAltitude: 250_000 }}
      />
    )

    expect(markup).toContain('ORB') // orbital regime label (bottom shelf)
    expect(markup).not.toContain('ORBITAL')
    // State and orbital closure are icons (titles), not text labels.
    expect(markup).not.toContain('FLY')
    expect(markup).toContain('Flying')
    expect(markup).toContain('Closed orbit')
    expect(markup).toContain('PE') // top shelf periapsis
    expect(markup).toContain('data-indicator="throttle"')
    expect(markup).toContain('data-indicator="force"')
    expect(markup).toContain('width="190"')
    expect(markup).toContain('height="180"')
    expect(markup).toContain('M 159 154 A 90 90 0 0 0 159 26')
    expect(markup).toContain('M 31 154 A 90 90 0 0 1 31 26')
  })

  it('renders surface regime and a crashed-state icon', () => {
    const markup = renderToStaticMarkup(
      <NavballInstrument
        {...navballProps}
        mode="surface"
        throttle={0.62}
        forceRatio={0.18}
        surfaceState="crashed"
        autopilotMode="off"
        orbit={{ kind: 'impacting', periapsisAltitude: -5_000, apoapsisAltitude: null }}
      />
    )

    expect(markup).toContain('SUR')
    expect(markup).not.toContain('SURFACE')
    expect(markup).not.toContain('CRASH') // state shown as an icon, not text
    expect(markup).toContain('Crashed')
    expect(markup).toContain('Impact trajectory')
  })

  it('sizes the raw navball as a 170px drawing', () => {
    const markup = renderToStaticMarkup(<Navball {...navballProps} />)

    expect(markup).toContain('width="170"')
    expect(markup).toContain('height="170"')
  })

  it('keeps the navball backing circle inside the raw SVG viewport', () => {
    const markup = renderToStaticMarkup(<Navball {...navballProps} />)

    expect(markup).not.toContain('r="92"')
  })

  it('insets the visible navball sphere so the outer stroke is not clipped', () => {
    const markup = renderToStaticMarkup(<Navball {...navballProps} />)

    expect(markup).toContain('r="83.5"')
    expect(markup).not.toContain('r="85" fill="url(#navball-shade)"')
  })

  it('keeps raw Navball free of duplicate mode labels', () => {
    const markup = renderToStaticMarkup(<Navball {...navballProps} />)

    expect(markup).not.toContain('ORBIT NAV')
    expect(markup).not.toContain('SURF NAV')
  })
})
