import { lazy, Suspense, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { useModeStore } from './state/mode'
import { startSim, stopSim } from './state/bridge'
import { MainMenu } from './ui/MainMenu'
import { HudTestPage } from './ui/HudTestPage'
import { Flight } from './modes/Flight'
import { isKnownScenarioId, mainPath, missionPath, spikeAtmospherePath, testHudPath } from './appRoutes'

// Lazy so the takram/postprocessing spike deps stay out of the main flight bundle.
const AtmosphereSpikePage = lazy(() =>
  import('./spike/AtmosphereSpike').then((m) => ({ default: m.AtmosphereSpikePage })),
)

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={mainPath} replace />} />
      <Route path={mainPath} element={<MainRoute />} />
      <Route path={testHudPath} element={<HudTestPage />} />
      <Route
        path={spikeAtmospherePath}
        element={
          <Suspense fallback={<Shell><div>LOADING SPIKE</div></Shell>}>
            <AtmosphereSpikePage />
          </Suspense>
        }
      />
      <Route path="/mission/:scenarioId" element={<MissionRoute />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function MainRoute() {
  const navigate = useNavigate()
  const enterMenu = useModeStore((s) => s.enterMenu)

  useEffect(() => {
    stopSim()
    enterMenu()
  }, [enterMenu])

  return <MainMenu onLaunch={(scenarioId) => navigate(missionPath(scenarioId))} />
}

function MissionRoute() {
  const { scenarioId } = useParams()
  const enterFlight = useModeStore((s) => s.enterFlight)
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    if (!scenarioId || !isKnownScenarioId(scenarioId)) return
    const missionScenarioId = scenarioId

    let cancelled = false

    async function launchMission() {
      setStatus('loading')
      stopSim()
      try {
        await startSim(missionScenarioId)
        if (!cancelled) {
          enterFlight(missionScenarioId)
          setStatus('ready')
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error)
          setStatus('failed')
        }
      }
    }

    void launchMission()

    return () => {
      cancelled = true
    }
  }, [enterFlight, scenarioId])

  if (!scenarioId || !isKnownScenarioId(scenarioId)) {
    return <NotFound title="Unknown mission" detail={scenarioId ? `No mission exists for ${scenarioId}.` : undefined} />
  }

  if (status === 'failed') {
    return <NotFound title="Mission failed to load" detail={`Could not load ${scenarioId}.`} />
  }

  if (status === 'loading') return <LoadingMission scenarioId={scenarioId} />

  return <Flight />
}

function LoadingMission({ scenarioId }: { scenarioId: string }) {
  return (
    <Shell>
      <div style={{ opacity: 0.6, fontSize: 11 }}>LOADING MISSION</div>
      <div>{scenarioId}</div>
    </Shell>
  )
}

function NotFound({ title = 'Not found', detail }: { title?: string; detail?: string }) {
  const navigate = useNavigate()
  return (
    <Shell>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{title}</div>
      {detail && <div style={{ opacity: 0.65, marginBottom: 24 }}>{detail}</div>}
      <button
        onClick={() => navigate(mainPath)}
        style={{
          padding: '10px 20px',
          background: 'rgba(100,180,255,0.15)',
          color: 'white',
          border: '1px solid rgba(100,180,255,0.4)',
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: 'monospace',
        }}
      >
        Back to main
      </button>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0a0a12',
        color: 'white',
        fontFamily: 'monospace',
      }}
    >
      {children}
    </div>
  )
}
