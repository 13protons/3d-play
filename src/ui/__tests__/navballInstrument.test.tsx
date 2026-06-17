import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Navball, NavballInstrument, StatusColumn } from '../Navball'
import { computeArcProgressPath, computeForceLoadRatio } from '../navballInstrumentMath'

/** Extract the M start point and the A endpoint from an arc path string. */
function pathPoints(path: string): [number, number][] {
  const n = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  return [[n[0], n[1]], [n[n.length - 2], n[n.length - 1]]]
}

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

  it('places arc endpoints on the radius-r circle (sub-pixel, no bulge)', () => {
    const right = computeArcProgressPath({ value: 0.5, radius: 90, cx: 95, cy: 90, startDegrees: 135, endDegrees: 45 })
    const left = computeArcProgressPath({ value: 0, radius: 90, cx: 95, cy: 90, startDegrees: 135, endDegrees: 45, mirror: true })

    expect(right.trackPath).toContain('A 90 90 0 0 0')
    expect(right.progressPath).toContain('A 90 90 0 0 0')
    expect(left.trackPath).toContain('A 90 90 0 0 1')

    // Every coordinate in the path must lie on the radius-90 circle about
    // (95, 90) — that's what keeps the stroked arc from bulging off its track.
    for (const path of [right.trackPath, right.progressPath, left.trackPath]) {
      for (const [x, y] of pathPoints(path)) {
        expect(Math.hypot(x - 95, y - 90)).toBeCloseTo(90, 1)
      }
    }
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
  it('renders ap/pe and alt/vel shelves and arc progress bars', () => {
    const markup = renderToStaticMarkup(
      <NavballInstrument
        {...navballProps}
        throttle={0.62}
        forceRatio={0.18}
        atmosphereRatio={0.4}
        surfaceState="flying"
        autopilotMode="damp"
        orbit={{ kind: 'closed', periapsisAltitude: 100_000, apoapsisAltitude: 250_000 }}
        bottomRows={[
          { label: 'ALT', value: '12.0 km' },
          { label: 'VEL', value: '250 m/s' },
        ]}
      />
    )

    expect(markup).toContain('PE') // top shelf periapsis
    expect(markup).toContain('ALT') // bottom shelf altitude
    expect(markup).toContain('VEL') // bottom shelf velocity
    expect(markup).toContain('12.0 km')
    // Status indicators (frame/orbit/state) now live in StatusColumn, not here.
    expect(markup).not.toContain('Closed orbit')
    expect(markup).not.toContain('reference frame')
    expect(markup).toContain('width="190"')
    expect(markup).toContain('height="180"')
    // Right: throttle arc (thick, radius 90, sweep 0).
    expect(markup).toContain('A 90 90 0 0 0')
    expect(markup).toContain('stroke-width="6"')
    // Left: g-load arc (thin, radius 90, mirrored sweep 1) + atmosphere arc
    // (thin, radius 87, blue). Both 3-wide so they touch.
    expect(markup).toContain('A 90 90 0 0 1')
    expect(markup).toContain('A 87 87 0 0 1')
    expect(markup).toContain('stroke="#9cd8ff"')
    expect(markup).toContain('stroke="#2c4a5c"') // atmosphere track background
    expect(markup).toContain('stroke-width="3"')
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

describe('StatusColumn', () => {
  it('shows orbit and state indicators, and no reference-frame icon', () => {
    const markup = renderToStaticMarkup(
      <StatusColumn
        surfaceState="flying"
        orbit={{ kind: 'closed', periapsisAltitude: 100_000, apoapsisAltitude: 250_000 }}
      />
    )

    expect(markup).toContain('Closed orbit')
    expect(markup).toContain('Flying')
    expect(markup).not.toContain('reference frame')
  })

  it('dims an impact trajectory when not flying', () => {
    const markup = renderToStaticMarkup(
      <StatusColumn
        surfaceState="crashed"
        orbit={{ kind: 'impacting', periapsisAltitude: -5_000, apoapsisAltitude: null }}
      />
    )

    expect(markup).toContain('Impact trajectory')
    expect(markup).toContain('Crashed')
    expect(markup).toContain('opacity:0.3') // impact icon disabled on the ground
  })

  it('keeps an impact trajectory active while flying', () => {
    const markup = renderToStaticMarkup(
      <StatusColumn
        surfaceState="flying"
        orbit={{ kind: 'impacting', periapsisAltitude: -5_000, apoapsisAltitude: null }}
      />
    )

    expect(markup).toContain('Impact trajectory')
    expect(markup).not.toContain('opacity:0.3')
  })
})
