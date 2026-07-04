/**
 * Persistence for scene-editor drafts.
 *
 * Backend is the browser's localStorage (the working store during development).
 * Drafts serialize to/from JSON so a scene can be exported, committed into
 * `public/data/scenarios/`, and re-imported losslessly. The `Store` is
 * injectable so the logic is testable without a DOM, and so a future
 * dev-server-write backend is a drop-in replacement.
 */

import type { SceneDraft, VehiclePlacement } from '../data/sceneDraft'

const STORAGE_KEY = 'scene-editor:drafts:v1'

/** Minimal slice of the Web Storage API this module needs. */
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStore(): Store | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Access can throw in sandboxed/SSR contexts.
    return null
  }
}

function readAll(store: Store | null): Record<string, SceneDraft> {
  if (!store) return {}
  const raw = store.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, SceneDraft>) : {}
  } catch {
    return {}
  }
}

function writeAll(store: Store | null, map: Record<string, SceneDraft>): void {
  if (!store) return
  store.setItem(STORAGE_KEY, JSON.stringify(map))
}

export function listScenes(store: Store | null = defaultStore()): SceneDraft[] {
  return Object.values(readAll(store)).sort((a, b) => a.name.localeCompare(b.name))
}

export function loadScene(id: string, store: Store | null = defaultStore()): SceneDraft | null {
  return readAll(store)[id] ?? null
}

export function saveScene(draft: SceneDraft, store: Store | null = defaultStore()): void {
  const map = readAll(store)
  map[draft.id] = draft
  writeAll(store, map)
}

export function deleteScene(id: string, store: Store | null = defaultStore()): void {
  const map = readAll(store)
  delete map[id]
  writeAll(store, map)
}

/**
 * Allocate a storage id that doesn't collide with an existing draft. Derives a
 * readable slug from `name` and appends a numeric suffix when needed.
 */
export function uniqueSceneId(name: string, store: Store | null = defaultStore()): string {
  const map = readAll(store)
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scene'
  if (!map[base]) return base
  let n = 2
  while (map[`${base}-${n}`]) n += 1
  return `${base}-${n}`
}

/** Pretty-print a draft for download/commit. */
export function serializeScene(draft: SceneDraft): string {
  return JSON.stringify(draft, null, 2)
}

/**
 * Parse imported JSON into a draft. Accepts either a bare draft or a runtime
 * scenario that carries the authoring block under `authoring` (the shape the
 * editor exports for committing to the repo).
 */
export function parseScene(json: string): SceneDraft {
  const parsed: unknown = JSON.parse(json)
  const candidate =
    parsed && typeof parsed === 'object' && 'authoring' in parsed
      ? (parsed as { authoring: unknown }).authoring
      : parsed
  return assertSceneDraft(candidate)
}

function assertSceneDraft(value: unknown): SceneDraft {
  if (!value || typeof value !== 'object') throw new Error('Scene must be an object')
  const draft = value as Record<string, unknown>
  if (typeof draft.id !== 'string' || !draft.id) throw new Error('Scene is missing an id')
  if (typeof draft.name !== 'string') throw new Error('Scene is missing a name')
  if (!draft.bodies || typeof draft.bodies !== 'object') throw new Error('Scene is missing bodies')
  const vehicle = draft.vehicle as Record<string, unknown> | undefined
  if (!vehicle || typeof vehicle !== 'object') throw new Error('Scene is missing a vehicle')
  const placement = vehicle.placement as VehiclePlacement | undefined
  if (!placement || (placement.mode !== 'orbital' && placement.mode !== 'surface')) {
    throw new Error('Vehicle placement must be orbital or surface')
  }
  if (!draft.parentScrub || typeof draft.parentScrub !== 'object') {
    // Tolerate older/hand-written drafts that omit the scrub.
    draft.parentScrub = { deltaTrueAnomaly: 0 }
  }
  return draft as unknown as SceneDraft
}
