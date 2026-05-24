import { describe, expect, it } from 'vitest'
import {
  isKnownScenarioId,
  mainPath,
  mainMenuLinks,
  missionPath,
  parseAppRoute,
  scenarios,
  testHudPath,
} from '../appRoutes'

describe('appRoutes', () => {
  it('routes the main menu path', () => {
    expect(parseAppRoute('/main')).toEqual({ type: 'main' })
  })

  it('routes the HUD test playground path', () => {
    expect(testHudPath).toBe('/_test/hud')
    expect(parseAppRoute('/_test/hud')).toEqual({ type: 'test-hud' })
  })

  it('routes known missions by scenario id', () => {
    expect(parseAppRoute('/mission/sun-earth-moon')).toEqual({
      type: 'mission',
      scenarioId: 'sun-earth-moon',
    })
  })

  it('rejects unknown mission ids', () => {
    expect(parseAppRoute('/mission/missing')).toEqual({
      type: 'not-found',
      scenarioId: 'missing',
    })
  })

  it('builds canonical mission paths', () => {
    expect(mainPath).toBe('/main')
    expect(missionPath('inner-solar-system')).toBe('/mission/inner-solar-system')
  })

  it('includes a main menu link to the HUD playground', () => {
    expect(mainMenuLinks).toContainEqual({ label: 'HUD Playground', path: testHudPath })
  })

  it('exports the currently available scenarios', () => {
    expect(scenarios.map((scenario) => scenario.id)).toEqual([
      'sun-earth-moon',
      'inner-solar-system',
      'full-solar-system',
    ])
    expect(isKnownScenarioId('full-solar-system')).toBe(true)
    expect(isKnownScenarioId('missing')).toBe(false)
  })
})
