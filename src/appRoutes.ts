export const mainPath = '/main';
export const editorPath = '/editor';
export const testHudPath = '/_test/hud';

export function editorScenePath(sceneId: string): string {
  return `/editor/${encodeURIComponent(sceneId)}`;
}

export function playScenePath(sceneId: string): string {
  return `/play/${encodeURIComponent(sceneId)}`;
}

/**
 * Built-in scenarios usable as a starting body set for a new scene. Excludes
 * `jpl-ecliptic` scenarios, whose stored axes don't match the editor's y-up
 * orbital-element conventions.
 */
export const editorBaseScenarios = [
  { id: 'sun-earth-moon', label: 'Sun-Earth-Moon' },
  { id: 'inner-solar-system', label: 'Inner Solar System' },
  { id: 'two-stage-ascent', label: 'Two-Stage Ascent' },
] as const;
export const spikeEarthPath = '/_spike/earth';
export const spikeDawnPath = '/_spike/dawn';
export const spikeAtmospherePath = '/_spike/atmosphere';

export const scenarios = [
  { id: 'sun-earth-moon', label: 'Launch: Sun-Earth-Moon' },
  { id: 'inner-solar-system', label: 'Launch: Inner Solar System' },
  { id: 'full-solar-system', label: 'Launch: Full Solar System' },
  { id: 'two-stage-ascent', label: 'Launch: Two-Stage Ascent' },
] as const;

export const mainMenuLinks = [
  { label: 'HUD Playground', path: testHudPath },
  { label: 'Earth Spike', path: spikeEarthPath },
  { label: 'Dawn Spike', path: spikeDawnPath },
  { label: 'Atmosphere Spike', path: spikeAtmospherePath },
] as const;

export type ScenarioId = (typeof scenarios)[number]['id'];

export type AppRoute =
  | { type: 'main' }
  | { type: 'test-hud' }
  | { type: 'mission'; scenarioId: ScenarioId }
  | { type: 'not-found'; scenarioId?: string };

export function isKnownScenarioId(scenarioId: string): scenarioId is ScenarioId {
  return scenarios.some((scenario) => scenario.id === scenarioId);
}

export function missionPath(scenarioId: string): string {
  return `/mission/${scenarioId}`;
}

export function parseAppRoute(pathname: string): AppRoute {
  if (pathname === mainPath) return { type: 'main' };
  if (pathname === testHudPath) return { type: 'test-hud' };

  const missionMatch = pathname.match(/^\/mission\/([^/]+)$/);
  if (missionMatch) {
    const scenarioId = decodeURIComponent(missionMatch[1]);
    return isKnownScenarioId(scenarioId) ? { type: 'mission', scenarioId } : { type: 'not-found', scenarioId };
  }

  return { type: 'not-found' };
}
