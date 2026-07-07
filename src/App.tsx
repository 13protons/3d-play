import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useModeStore } from './state/mode';
import { loadBodyResolveMeta, startSim, startSimWithScenario, stopSim } from './state/bridge';
import { loadScene } from './state/scenarioStorage';
import { resolveScene } from './data/sceneDraft';
import { MainMenu } from './ui/MainMenu';
import { HudTestPage } from './ui/HudTestPage';
import { Flight } from './modes/Flight';
import { SceneList } from './modes/SceneList';
import { SceneEditor } from './modes/SceneEditor';
import { editorPath, isKnownScenarioId, mainPath, missionPath, spikeEarthPath, spikeDawnPath, spikeAtmospherePath, spikePartsPath, testHudPath } from './appRoutes';

// Lazy so the TSL spike deps stay out of the main flight bundle.
const EarthSpikePage = lazy(() => import('./spike/EarthSpike').then((m) => ({ default: m.EarthSpikePage })));
const DawnSpikePage = lazy(() => import('./spike/DawnSpike').then((m) => ({ default: m.DawnSpikePage })));
const AtmosphereSpikePage = lazy(() => import('./spike/AtmosphereSpike').then((m) => ({ default: m.AtmosphereSpikePage })));
const PartsSandboxPage = lazy(() => import('./spike/PartsSandbox').then((m) => ({ default: m.PartsSandboxPage })));

export default function App() {
  return (
    <Routes>
      <Route
        path='/'
        element={
          <Navigate
            to={mainPath}
            replace
          />
        }
      />
      <Route
        path={mainPath}
        element={<MainRoute />}
      />
      <Route
        path={testHudPath}
        element={<HudTestPage />}
      />
      <Route
        path={spikeEarthPath}
        element={
          <Suspense
            fallback={
              <div style={{ position: 'absolute', inset: 0, background: '#000', color: '#888', padding: 16 }}>
                LOADING EARTH SPIKE
              </div>
            }
          >
            <EarthSpikePage />
          </Suspense>
        }
      />
      <Route
        path={spikeDawnPath}
        element={
          <Suspense
            fallback={
              <div style={{ position: 'absolute', inset: 0, background: '#000', color: '#888', padding: 16 }}>
                LOADING DAWN SPIKE
              </div>
            }
          >
            <DawnSpikePage />
          </Suspense>
        }
      />
      <Route
        path={spikeAtmospherePath}
        element={
          <Suspense
            fallback={
              <div style={{ position: 'absolute', inset: 0, background: '#000', color: '#888', padding: 16 }}>
                LOADING ATMOSPHERE SPIKE
              </div>
            }
          >
            <AtmosphereSpikePage />
          </Suspense>
        }
      />
      <Route
        path={spikePartsPath}
        element={
          <Suspense
            fallback={
              <div style={{ position: 'absolute', inset: 0, background: '#000', color: '#888', padding: 16 }}>
                LOADING PARTS SANDBOX
              </div>
            }
          >
            <PartsSandboxPage />
          </Suspense>
        }
      />
      <Route
        path={editorPath}
        element={<SceneList />}
      />
      <Route
        path='/editor/:sceneId'
        element={<SceneEditor />}
      />
      <Route
        path='/play/:sceneId'
        element={<PlaySceneRoute />}
      />
      <Route
        path='/mission/:scenarioId'
        element={<MissionRoute />}
      />
      <Route
        path='*'
        element={<NotFound />}
      />
    </Routes>
  );
}

function MainRoute() {
  const navigate = useNavigate();
  const enterMenu = useModeStore((s) => s.enterMenu);

  useEffect(() => {
    stopSim();
    enterMenu();
  }, [enterMenu]);

  return <MainMenu onLaunch={(scenarioId) => navigate(missionPath(scenarioId))} />;
}

function MissionRoute() {
  const { scenarioId } = useParams();
  const enterFlight = useModeStore((s) => s.enterFlight);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    if (!scenarioId || !isKnownScenarioId(scenarioId)) return;
    const missionScenarioId = scenarioId;

    let cancelled = false;

    async function launchMission() {
      setStatus('loading');
      stopSim();
      try {
        await startSim(missionScenarioId);
        if (!cancelled) {
          enterFlight(missionScenarioId);
          setStatus('ready');
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setStatus('failed');
        }
      }
    }

    void launchMission();

    return () => {
      cancelled = true;
    };
  }, [enterFlight, scenarioId]);

  if (!scenarioId || !isKnownScenarioId(scenarioId)) {
    return (
      <NotFound
        title='Unknown mission'
        detail={scenarioId ? `No mission exists for ${scenarioId}.` : undefined}
      />
    );
  }

  if (status === 'failed') {
    return (
      <NotFound
        title='Mission failed to load'
        detail={`Could not load ${scenarioId}.`}
      />
    );
  }

  if (status === 'loading') return <LoadingMission scenarioId={scenarioId} />;

  return <Flight />;
}

function PlaySceneRoute() {
  const { sceneId } = useParams();
  const enterFlight = useModeStore((s) => s.enterFlight);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    if (!sceneId) return;
    let cancelled = false;

    async function launch() {
      setStatus('loading');
      stopSim();
      try {
        const draft = loadScene(sceneId!);
        if (!draft) throw new Error(`No saved scene: ${sceneId}`);
        const meta = await loadBodyResolveMeta(Object.keys(draft.bodies));
        const scenario = resolveScene(draft, meta);
        await startSimWithScenario(scenario);
        if (!cancelled) {
          enterFlight(draft.id);
          setStatus('ready');
        }
      } catch (error) {
        if (!cancelled) {
          console.error(error);
          setStatus('failed');
        }
      }
    }

    void launch();
    return () => {
      cancelled = true;
    };
  }, [enterFlight, sceneId]);

  if (status === 'failed') {
    return <NotFound title='Scene failed to load' detail={`Could not play ${sceneId}.`} />;
  }
  if (status === 'loading') return <LoadingMission scenarioId={sceneId ?? ''} />;
  return <Flight />;
}

function LoadingMission({ scenarioId }: { scenarioId: string }) {
  return (
    <Shell>
      <div style={{ opacity: 0.6, fontSize: 11 }}>LOADING MISSION</div>
      <div>{scenarioId}</div>
    </Shell>
  );
}

function NotFound({ title = 'Not found', detail }: { title?: string; detail?: string }) {
  const navigate = useNavigate();
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
  );
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
  );
}
