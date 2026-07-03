import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  deleteScene,
  listScenes,
  loadScene,
  parseScene,
  saveScene,
  uniqueSceneId,
} from '../state/scenarioStorage'
import { buildDraftFromScenario, resolveScene, type SceneDraft } from '../data/sceneDraft'
import { loadBodyResolveMeta } from '../state/bridge'
import {
  editorBaseScenarios,
  editorScenePath,
  mainPath,
  playScenePath,
} from '../appRoutes'

/** List / create / import / export / delete saved scenes (localStorage). */
export function SceneList() {
  const navigate = useNavigate()
  const [scenes, setScenes] = useState<SceneDraft[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function refresh() {
    setScenes(listScenes())
  }
  useEffect(refresh, [])

  async function createFromBase(baseId: string) {
    setBusy(`Creating from ${baseId}…`)
    setError(null)
    try {
      const resp = await fetch(`/data/scenarios/${baseId}.json`)
      if (!resp.ok) throw new Error(`Failed to load base scenario ${baseId}`)
      const scenario = await resp.json()
      const meta = await loadBodyResolveMeta(Object.keys(scenario.bodies))
      const id = uniqueSceneId(`${baseId}-edit`)
      const draft = buildDraftFromScenario(scenario, meta, {
        id,
        name: `${scenario.name ?? baseId} (edit)`,
        baseScenarioId: baseId,
        epoch: scenario.epoch ?? 0,
      })
      saveScene(draft)
      navigate(editorScenePath(id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function remove(id: string) {
    if (!confirm(`Delete scene "${id}"? This cannot be undone.`)) return
    deleteScene(id)
    refresh()
  }

  async function exportScene(draft: SceneDraft) {
    setError(null)
    try {
      // Export as a runtime scenario carrying the authoring block: it loads as a
      // normal committed scenario and reopens losslessly in the editor.
      const meta = await loadBodyResolveMeta(Object.keys(draft.bodies))
      const runtime = resolveScene(draft, meta)
      const payload = JSON.stringify({ ...runtime, authoring: draft }, null, 2)
      downloadJson(`${draft.id}.json`, payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function onImportFile(file: File) {
    setError(null)
    try {
      const draft = parseScene(await file.text())
      // Avoid clobbering an existing scene with the same id.
      if (loadScene(draft.id)) draft.id = uniqueSceneId(draft.name)
      saveScene(draft)
      refresh()
    } catch (e) {
      setError(`Import failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div style={page}>
      <div style={{ width: 'min(680px, 92vw)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 32, fontWeight: 300, margin: 0 }}>Scene Editor</h1>
          <button style={linkBtn} onClick={() => navigate(mainPath)}>
            ← Main menu
          </button>
        </div>
        <p style={{ opacity: 0.5, marginTop: 6 }}>Saved scenes (stored in this browser)</p>

        {error && <div style={errorBox}>{error}</div>}
        {busy && <div style={{ opacity: 0.7, marginBottom: 12 }}>{busy}</div>}

        <div style={{ display: 'grid', gap: 10, marginBottom: 28 }}>
          {scenes.length === 0 && (
            <div style={{ opacity: 0.5, padding: '12px 0' }}>
              No scenes yet — create one from a base scenario below.
            </div>
          )}
          {scenes.map((scene) => (
            <div key={scene.id} style={row}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15 }}>{scene.name}</div>
                <div style={{ opacity: 0.45, fontSize: 11 }}>
                  {scene.id} · base: {scene.baseScenarioId} · parent: {scene.vehicle.parentId} ·{' '}
                  {scene.vehicle.placement.mode}
                </div>
              </div>
              <button style={primaryBtn} onClick={() => navigate(playScenePath(scene.id))}>
                Play
              </button>
              <button style={btn} onClick={() => navigate(editorScenePath(scene.id))}>
                Edit
              </button>
              <button style={btn} onClick={() => void exportScene(scene)}>
                Export
              </button>
              <button style={dangerBtn} onClick={() => remove(scene.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: 14, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 2 }}>
          New scene from base
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
          {editorBaseScenarios.map((base) => (
            <button key={base.id} style={btn} disabled={busy !== null} onClick={() => void createFromBase(base.id)}>
              {base.label}
            </button>
          ))}
        </div>

        <h2 style={{ fontSize: 14, opacity: 0.7, textTransform: 'uppercase', letterSpacing: 2 }}>
          Import
        </h2>
        <input
          ref={fileInputRef}
          type='file'
          accept='application/json,.json'
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onImportFile(file)
            e.target.value = ''
          }}
        />
        <button style={btn} onClick={() => fileInputRef.current?.click()}>
          Import scene JSON…
        </button>
      </div>
    </div>
  )
}

function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0a0a12',
  color: 'white',
  fontFamily: 'monospace',
  display: 'flex',
  justifyContent: 'center',
  padding: '48px 16px',
}
const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.03)',
}
const btn: React.CSSProperties = {
  padding: '7px 14px',
  fontSize: 13,
  background: 'rgba(255,255,255,0.06)',
  color: 'white',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'monospace',
}
const primaryBtn: React.CSSProperties = {
  ...btn,
  background: 'rgba(120,230,255,0.16)',
  border: '1px solid rgba(120,230,255,0.45)',
  color: '#d8f8ff',
}
const dangerBtn: React.CSSProperties = {
  ...btn,
  background: 'rgba(255,90,90,0.12)',
  border: '1px solid rgba(255,90,90,0.4)',
  color: '#ffd2d2',
}
const linkBtn: React.CSSProperties = {
  ...btn,
  background: 'transparent',
  border: 'none',
  opacity: 0.7,
}
const errorBox: React.CSSProperties = {
  border: '1px solid rgba(255,90,90,0.5)',
  background: 'rgba(255,90,90,0.1)',
  color: '#ffd2d2',
  padding: '8px 12px',
  borderRadius: 6,
  marginBottom: 12,
  fontSize: 13,
}
