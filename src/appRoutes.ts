export const mainPath = '/main'
export const testHudPath = '/_test/hud'

export const scenarios = [
  { id: 'sun-earth-moon', label: 'Launch: Sun-Earth-Moon' },
  { id: 'inner-solar-system', label: 'Launch: Inner Solar System' },
  { id: 'full-solar-system', label: 'Launch: Full Solar System' },
  { id: 'two-stage-ascent', label: 'Launch: Two-Stage Ascent' },
] as const

export const mainMenuLinks = [
  { label: 'HUD Playground', path: testHudPath },
] as const

export type ScenarioId = typeof scenarios[number]['id']

export type AppRoute =
  | { type: 'main' }
  | { type: 'test-hud' }
  | { type: 'mission'; scenarioId: ScenarioId }
  | { type: 'not-found'; scenarioId?: string }

export function isKnownScenarioId(scenarioId: string): scenarioId is ScenarioId {
  return scenarios.some((scenario) => scenario.id === scenarioId)
}

export function missionPath(scenarioId: string): string {
  return `/mission/${scenarioId}`
}

export function parseAppRoute(pathname: string): AppRoute {
  if (pathname === mainPath) return { type: 'main' }
  if (pathname === testHudPath) return { type: 'test-hud' }

  const missionMatch = pathname.match(/^\/mission\/([^/]+)$/)
  if (missionMatch) {
    const scenarioId = decodeURIComponent(missionMatch[1])
    return isKnownScenarioId(scenarioId)
      ? { type: 'mission', scenarioId }
      : { type: 'not-found', scenarioId }
  }

  return { type: 'not-found' }
}
