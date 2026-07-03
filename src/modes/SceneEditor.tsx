import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Scene } from '../render/Scene'
import { VehicleScene } from '../render/VehicleScene'
import { useModeStore } from '../state/mode'
import {
  isSimPaused,
  loadBodyResolveMeta,
  pauseSim,
  resumeSim,
  startSimWithScenario,
  stepSim,
  stopSim,
} from '../state/bridge'
import {
  resolveScene,
  type BodyResolveMeta,
  type SceneDraft,
  type VehiclePlacement,
} from '../data/sceneDraft'
import { loadScene, saveScene, uniqueSceneId } from '../state/scenarioStorage'
import { captureCameraPose, restoreCameraPose } from '../render/cameraControl'
import { editorScenePath, editorPath } from '../appRoutes'

const APPLY_DEBOUNCE_MS = 300

const RAD = Math.PI / 180

interface ApplyOptions {
  /** Re-frame the camera to ~4× this radius (used when the parent body changes). */
  frameRadius?: number
}

/** Scene editor: live preview (restart-on-apply) + placement + edit-time clock. */
export function SceneEditor() {
  const { sceneId } = useParams()
  const navigate = useNavigate()
  const metaRef = useRef<Record<string, BodyResolveMeta>>({})
  const [draft, setDraft] = useState<SceneDraft | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [paused, setPaused] = useState(true)
  const [stepSeconds, setStepSeconds] = useState(10)
  const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Apply the current draft to the live sim (stop + restart + re-pause).
  // preserveScene keeps the render stores populated across the restart so the
  // mounted scene survives (a full teardown intermittently wedges the live
  // WebGPU canvas — see stopSim). The camera pose is captured relative to the
  // focal point and restored after the restart, so tweaking values doesn't
  // fling the view off the subject; `frameRadius` (parent switch) instead
  // re-frames to the new body's scale, keeping only the view direction.
  const apply = useCallback(async (d: SceneDraft, opts?: ApplyOptions) => {
    setErrorMsg(null)
    const pose = captureCameraPose()
    try {
      stopSim({ preserveScene: true })
      const scenario = resolveScene(d, metaRef.current)
      await startSimWithScenario(scenario)
      useModeStore.getState().enterFlight(d.id)
      pauseSim()
      setPaused(true)
      if (pose) {
        if (opts?.frameRadius) {
          const distance = Math.hypot(...pose.position)
          const scale = distance > 0 ? (opts.frameRadius * 4) / distance : 1
          restoreCameraPose({
            position: [pose.position[0] * scale, pose.position[1] * scale, pose.position[2] * scale],
            target: [0, 0, 0],
          })
        } else {
          restoreCameraPose(pose)
        }
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Debounced auto-apply: edits settle for a beat, then the scene re-resolves
  // and restarts. Replaces an explicit Apply button.
  const scheduleApply = useCallback(
    (next: SceneDraft, opts?: ApplyOptions) => {
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current)
      applyTimerRef.current = setTimeout(() => void apply(next, opts), APPLY_DEBOUNCE_MS)
    },
    [apply],
  )

  // Load draft + body metadata, then apply once for the initial preview.
  useEffect(() => {
    let cancelled = false
    async function load() {
      const loaded = sceneId ? loadScene(sceneId) : null
      if (!loaded) {
        setStatus('missing')
        return
      }
      try {
        metaRef.current = await loadBodyResolveMeta(Object.keys(loaded.bodies))
        if (cancelled) return
        setDraft(loaded)
        setStatus('ready')
        await apply(loaded)
      } catch (e) {
        if (!cancelled) {
          setErrorMsg(e instanceof Error ? e.message : String(e))
          setStatus('error')
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [sceneId, apply])

  // Tear the sim down when leaving the editor.
  useEffect(() => {
    return () => {
      if (applyTimerRef.current) clearTimeout(applyTimerRef.current)
      stopSim()
      useModeStore.getState().enterMenu()
    }
  }, [])

  function update(mutate: (d: SceneDraft) => SceneDraft, opts?: ApplyOptions) {
    if (!draft) return
    const next = mutate(structuredClone(draft))
    setDraft(next)
    scheduleApply(next, opts)
  }

  function setPlacement(placement: VehiclePlacement) {
    update((d) => {
      d.vehicle.placement = placement
      return d
    })
  }

  function changeParent(parentId: string) {
    const radius = metaRef.current[parentId]?.radius ?? 1_000_000
    update(
      (d) => {
        d.vehicle.parentId = parentId
        // Elements are parent-relative; reset to a clean low orbit around the new
        // parent so stale values from the old parent don't place the craft absurdly.
        d.vehicle.placement = { mode: 'orbital', a: radius * 1.2, e: 0, i: 0, lan: 0, aop: 0, ta: 0 }
        d.parentScrub = { deltaTrueAnomaly: 0 }
        return d
      },
      // Re-frame the camera to the new parent's scale — holding an Earth-sized
      // viewing distance leaves a Moon-sized parent an invisible speck.
      { frameRadius: radius },
    )
  }

  function save(asNew: boolean) {
    if (!draft) return
    let next = draft
    if (asNew) {
      const name = prompt('Save as — scene name:', `${draft.name} copy`)
      if (!name) return
      const id = uniqueSceneId(name)
      next = { ...structuredClone(draft), id, name }
      setDraft(next)
    }
    saveScene(next)
    if (asNew) navigate(editorScenePath(next.id), { replace: true })
  }

  function exportDraft() {
    if (!draft) return
    const runtime = resolveScene(draft, metaRef.current)
    const blob = new Blob([JSON.stringify({ ...runtime, authoring: draft }, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${draft.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function togglePause() {
    // Drive off the bridge's authoritative pause flag, not the React mirror —
    // the mirror can drift (HMR, async apply ordering) and a blind toggle would
    // then desync the displayed state from the actual clock.
    if (isSimPaused()) {
      resumeSim()
      setPaused(false)
    } else {
      pauseSim()
      setPaused(true)
    }
  }

  if (status === 'missing') {
    return (
      <Centered>
        <div style={{ fontSize: 22, marginBottom: 12 }}>Scene not found</div>
        <button style={btn} onClick={() => navigate(editorPath)}>
          Back to scenes
        </button>
      </Centered>
    )
  }
  if (status === 'loading' || !draft) {
    return <Centered>Loading scene…</Centered>
  }

  const activeView = useModeStore.getState().activeView
  const bodyIds = Object.keys(draft.bodies)
  const placement = draft.vehicle.placement

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000', overflow: 'hidden' }}>
      {/* Live preview — same renderers Flight uses. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: activeView === 'orbital' ? 'block' : 'none',
        }}
      >
        <Scene />
      </div>
      <VehicleScene />

      {/* Edit-mode clock toolbar (distinct from the pause overlay menu). */}
      <div style={toolbar}>
        <span style={{ color: paused ? '#ffd27a' : '#7affa0', letterSpacing: 2 }}>
          {paused ? '❚❚ EDIT · PAUSED' : '▶ EDIT · RUNNING'}
        </span>
        <button style={btn} onClick={togglePause}>
          {paused ? 'Play ▶' : 'Pause ❚❚'}
        </button>
        <button style={btn} onClick={() => stepSim(stepSeconds)}>
          Step +{stepSeconds}s
        </button>
        <input
          type='number'
          value={stepSeconds}
          min={0}
          onChange={(e) => setStepSeconds(Math.max(0, Number(e.target.value)))}
          style={{ ...input, width: 70 }}
        />
      </div>

      {/* Editor panel. */}
      <div style={panel}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <input
            value={draft.name}
            onChange={(e) => update((d) => ((d.name = e.target.value), d))}
            style={{ ...input, fontSize: 16, flex: 1, marginRight: 8 }}
          />
          <button style={linkBtn} onClick={() => navigate(editorPath)}>
            ✕
          </button>
        </div>
        <div style={{ opacity: 0.45, fontSize: 11, marginBottom: 8 }}>
          {draft.id} · base {draft.baseScenarioId}
        </div>

        {errorMsg && <div style={errorBox}>{errorMsg}</div>}

        <Section title='Parent body'>
          <Field label='Parent'>
            <select
              value={draft.vehicle.parentId}
              onChange={(e) => changeParent(e.target.value)}
              style={input}
            >
              {bodyIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
          <SliderField
            label='Orbit phase Δ (deg)'
            value={draft.parentScrub.deltaTrueAnomaly / RAD}
            min={-180}
            max={180}
            step={1}
            onChange={(deg) => update((d) => ((d.parentScrub.deltaTrueAnomaly = deg * RAD), d))}
          />
          <SliderField
            label='Rotation phase (deg)'
            value={(draft.bodies[draft.vehicle.parentId]?.rotationPhase ?? 0) / RAD}
            min={0}
            max={360}
            step={1}
            onChange={(deg) =>
              update((d) => {
                const body = d.bodies[d.vehicle.parentId]
                if (body) body.rotationPhase = deg * RAD
                return d
              })
            }
          />
        </Section>

        <Section title='Vehicle placement'>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <ModeButton
              active={placement.mode === 'orbital'}
              onClick={() => {
                if (placement.mode === 'orbital') return
                const radius = metaRef.current[draft.vehicle.parentId]?.radius ?? 1_000_000
                setPlacement({ mode: 'orbital', a: radius * 1.2, e: 0, i: 0, lan: 0, aop: 0, ta: 0 })
              }}
            >
              Orbital
            </ModeButton>
            <ModeButton
              active={placement.mode === 'surface'}
              onClick={() => {
                if (placement.mode === 'surface') return
                setPlacement({ mode: 'surface', lat: 0, lon: 0, altitude: 0, surfaceVelocity: [0, 0, 0] })
              }}
            >
              Surface
            </ModeButton>
          </div>

          {placement.mode === 'orbital' ? (
            <>
              <SliderField
                label='Orbital phase ν (deg)'
                value={wrap180(placement.ta / RAD)}
                min={-180}
                max={180}
                step={1}
                onChange={(v) => setPlacement({ ...placement, ta: v * RAD })}
              />
              <NumberField
                label='Semi-major axis a (m)'
                value={placement.a}
                onChange={(a) => setPlacement({ ...placement, a })}
              />
              <NumberField
                label='Eccentricity e'
                value={placement.e}
                step={0.01}
                onChange={(e) => setPlacement({ ...placement, e })}
              />
              <NumberField
                label='Inclination i (deg)'
                value={placement.i / RAD}
                onChange={(v) => setPlacement({ ...placement, i: v * RAD })}
              />
              <NumberField
                label='LAN Ω (deg)'
                value={placement.lan / RAD}
                onChange={(v) => setPlacement({ ...placement, lan: v * RAD })}
              />
              <NumberField
                label='Arg. periapsis ω (deg)'
                value={placement.aop / RAD}
                onChange={(v) => setPlacement({ ...placement, aop: v * RAD })}
              />
            </>
          ) : (
            <>
              <NumberField
                label='Latitude (deg)'
                value={placement.lat / RAD}
                onChange={(v) => setPlacement({ ...placement, lat: v * RAD })}
              />
              <NumberField
                label='Longitude (deg)'
                value={placement.lon / RAD}
                onChange={(v) => setPlacement({ ...placement, lon: v * RAD })}
              />
              <NumberField
                label='Altitude (m)'
                value={placement.altitude}
                onChange={(altitude) => setPlacement({ ...placement, altitude })}
              />
              <NumberField
                label='Surface vel E (m/s)'
                value={placement.surfaceVelocity[0]}
                onChange={(x) =>
                  setPlacement({ ...placement, surfaceVelocity: [x, placement.surfaceVelocity[1], placement.surfaceVelocity[2]] })
                }
              />
              <NumberField
                label='Surface vel N (m/s)'
                value={placement.surfaceVelocity[1]}
                onChange={(y) =>
                  setPlacement({ ...placement, surfaceVelocity: [placement.surfaceVelocity[0], y, placement.surfaceVelocity[2]] })
                }
              />
              <NumberField
                label='Surface vel Up (m/s)'
                value={placement.surfaceVelocity[2]}
                onChange={(z) =>
                  setPlacement({ ...placement, surfaceVelocity: [placement.surfaceVelocity[0], placement.surfaceVelocity[1], z] })
                }
              />
            </>
          )}
        </Section>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button style={primaryBtn} onClick={() => save(false)}>
            Save
          </button>
          <button style={btn} onClick={() => save(true)}>
            Save As…
          </button>
          <button style={btn} onClick={exportDraft}>
            Export
          </button>
        </div>
        <div style={{ opacity: 0.4, fontSize: 11, marginTop: 8 }}>
          Edits apply automatically · camera holds its angle on the vehicle
        </div>
      </div>
    </div>
  )
}

// --- small presentational helpers -----------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12 }}>
      <span style={{ flex: 1, opacity: 0.8 }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </label>
  )
}

function NumberField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  step?: number
  onChange: (v: number) => void
}) {
  // Local string state so the user can type intermediate values freely.
  // Re-sync from the prop when it changes externally (parent reset, mode
  // switch) using the "adjust state during render" pattern rather than an effect.
  const [text, setText] = useState(String(round(value)))
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(String(round(value)))
  }
  return (
    <Field label={label}>
      <input
        type='number'
        value={text}
        step={step}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (Number.isFinite(n)) onChange(n)
        }}
        style={input}
      />
    </Field>
  )
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  return (
    <Field label={`${label}: ${round(value)}`}>
      <input
        type='range'
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
    </Field>
  )
}

function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...btn,
        flex: 1,
        background: active ? 'rgba(120,230,255,0.2)' : 'rgba(255,255,255,0.05)',
        border: active ? '1px solid rgba(120,230,255,0.5)' : '1px solid rgba(255,255,255,0.15)',
        color: active ? '#d8f8ff' : 'white',
      }}
    >
      {children}
    </button>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0a0a12',
        color: 'white',
        fontFamily: 'monospace',
      }}
    >
      <div style={{ textAlign: 'center' }}>{children}</div>
    </div>
  )
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

/** Normalize degrees to the (-180, 180] range so the slider thumb maps cleanly. */
function wrap180(deg: number): number {
  return (((deg + 180) % 360) + 360) % 360 - 180
}

// --- styles ----------------------------------------------------------------

const panel: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  bottom: 0,
  width: 340,
  overflowY: 'auto',
  padding: 16,
  background: 'rgba(6, 12, 22, 0.9)',
  borderRight: '1px solid rgba(120,230,255,0.25)',
  color: '#e6f6ff',
  fontFamily: 'monospace',
  zIndex: 10,
}
const toolbar: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 356,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  background: 'rgba(6, 12, 22, 0.85)',
  border: '1px solid rgba(120,230,255,0.25)',
  borderRadius: 8,
  color: '#e6f6ff',
  fontFamily: 'monospace',
  fontSize: 13,
  zIndex: 10,
}
const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '4px 6px',
  background: 'rgba(0,0,0,0.4)',
  color: '#e6f6ff',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 4,
  fontFamily: 'monospace',
  fontSize: 12,
}
const btn: React.CSSProperties = {
  padding: '6px 12px',
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
  background: 'rgba(120,230,255,0.18)',
  border: '1px solid rgba(120,230,255,0.5)',
  color: '#d8f8ff',
}
const linkBtn: React.CSSProperties = { ...btn, background: 'transparent', border: 'none', opacity: 0.7 }
const errorBox: React.CSSProperties = {
  border: '1px solid rgba(255,90,90,0.5)',
  background: 'rgba(255,90,90,0.1)',
  color: '#ffd2d2',
  padding: '6px 10px',
  borderRadius: 6,
  margin: '8px 0',
  fontSize: 12,
}
