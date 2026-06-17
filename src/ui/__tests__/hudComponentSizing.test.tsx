import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MagnitudeIndicator } from '../MagnitudeIndicator'
import { Attitude, Proximity } from '../Navball'

const rows = [
  { label: 'ALT', value: '400.0 km' },
  { label: 'VEL', value: '7.7 km/s' },
]

describe('HUD component sizing', () => {
  it('renders Proximity with a fixed 180px total width', () => {
    const markup = renderToStaticMarkup(<Proximity rows={rows} />)

    expect(markup).toContain('width:180px')
  })

  it('renders Attitude with a fixed 180px total width', () => {
    const markup = renderToStaticMarkup(<Attitude rows={rows} />)

    expect(markup).toContain('width:180px')
  })

  it('renders Angular Rates bars with a fixed 180px total width', () => {
    const markup = renderToStaticMarkup(<MagnitudeIndicator label="PITCH" value={1} min={-6} max={6} />)

    expect(markup).toContain('width:180px')
  })
})

describe('HUD component colors', () => {
  it('renders Proximity labels and values with Angular Rates colors', () => {
    const markup = renderToStaticMarkup(<Proximity rows={rows} />)

    expect(markup).toContain('color:rgba(210,250,255,0.62)')
    expect(markup).toContain('color:rgba(255,205,112,0.94)')
  })

  it('renders Attitude labels and values with Angular Rates colors', () => {
    const markup = renderToStaticMarkup(<Attitude rows={rows} />)

    expect(markup).toContain('color:rgba(210,250,255,0.62)')
    expect(markup).toContain('color:rgba(255,205,112,0.94)')
  })

  it('renders only the given rows (state moved to the navball shelf)', () => {
    const markup = renderToStaticMarkup(<Attitude rows={[{ label: 'MASS', value: '9000 kg' }]} />)

    expect(markup).toContain('MASS')
    expect(markup).not.toContain('STATE')
  })
})
