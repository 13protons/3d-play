import { describe, it, expect, beforeEach } from 'vitest'
import {
  listScenes,
  loadScene,
  saveScene,
  deleteScene,
  uniqueSceneId,
  serializeScene,
  parseScene,
  type Store,
} from '../scenarioStorage'
import type { SceneDraft } from '../../data/sceneDraft'

function fakeStore(): Store {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

function draft(id: string, name = id): SceneDraft {
  return {
    id,
    name,
    epoch: 0,
    baseScenarioId: 'sun-earth-moon',
    bodies: { earth: { position: { sector: [0, 0, 0], local: [0, 0, 0] }, velocity: [0, 0, 0], rotationPhase: 0 } },
    parentScrub: { deltaTrueAnomaly: 0 },
    vehicle: {
      id: 'v1',
      name: 'Orbiter',
      parentId: 'earth',
      placement: { mode: 'orbital', a: 6_771_000, e: 0, i: 0, lan: 0, aop: 0, ta: 0 },
    },
  }
}

describe('scenarioStorage CRUD', () => {
  let store: Store
  beforeEach(() => {
    store = fakeStore()
  })

  it('saves, lists, loads, and deletes', () => {
    expect(listScenes(store)).toEqual([])
    saveScene(draft('alpha', 'Alpha'), store)
    saveScene(draft('beta', 'Beta'), store)
    expect(listScenes(store).map((s) => s.id)).toEqual(['alpha', 'beta'])
    expect(loadScene('alpha', store)?.name).toBe('Alpha')

    deleteScene('alpha', store)
    expect(loadScene('alpha', store)).toBeNull()
    expect(listScenes(store).map((s) => s.id)).toEqual(['beta'])
  })

  it('upserts by id', () => {
    saveScene(draft('alpha', 'Alpha'), store)
    saveScene(draft('alpha', 'Alpha Renamed'), store)
    expect(listScenes(store)).toHaveLength(1)
    expect(loadScene('alpha', store)?.name).toBe('Alpha Renamed')
  })

  it('allocates collision-free ids from a name', () => {
    expect(uniqueSceneId('My Test Scene', store)).toBe('my-test-scene')
    saveScene(draft('my-test-scene', 'My Test Scene'), store)
    expect(uniqueSceneId('My Test Scene', store)).toBe('my-test-scene-2')
  })
})

describe('scenarioStorage serialize/import', () => {
  it('round-trips a bare draft', () => {
    const d = draft('alpha', 'Alpha')
    expect(parseScene(serializeScene(d))).toEqual(d)
  })

  it('extracts the authoring block from a runtime scenario export', () => {
    const d = draft('alpha', 'Alpha')
    const runtimeExport = JSON.stringify({ id: 'alpha', name: 'Alpha', bodies: {}, vehicles: [], authoring: d })
    expect(parseScene(runtimeExport)).toEqual(d)
  })

  it('rejects malformed scenes', () => {
    expect(() => parseScene('{}')).toThrow()
    expect(() => parseScene(JSON.stringify({ id: 'x', name: 'x', bodies: {} }))).toThrow(/vehicle/)
  })
})
