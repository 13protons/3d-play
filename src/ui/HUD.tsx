import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { useInputStore } from '../state/input'
import { useManeuverStore } from '../state/maneuver'
import { useModeStore } from '../state/mode'
import { useAutopilotStore } from '../state/autopilot'
import { maneuverBurnDirection, type ManeuverDeltaV, type ManeuverNode } from '../sim/maneuverNode'
import { attitudeDiagnostics, type AttitudeAxisDiagnostic } from './attitudeDiagnostics'
import { countRender } from '../render/perfCounters'
import { useThrottledRender } from './useThrottledRender'
import { TooltipOverlay } from './Tooltip'
import type { VehicleControlMeta } from '../state/trajectories'
import { WARP_RATES } from '../sim/warp'
import { evaluateCurve, evaluateCurveVelocity } from '../sim/curves'
import { computeFlightReadout, flightTelemetryRows } from './flightReadout'
import { NavballCluster } from './Navball'
import { computeForceLoadRatio } from './navballInstrumentMath'
import {
  computeFlightReferenceFrame,
  rotationAxisFromAxialTilt,
} from '../sim/vehicle/referenceFrame'

const DELTA_V_AXES: { key: keyof ManeuverDeltaV; positive: string; negative: string }[] = [
  { key: 'prograde', positive: 'Pro', negative: 'Retro' },
  { key: 'normal', positive: 'Nor', negative: 'Anti' },
  { key: 'radial', positive: 'Rad+', negative: 'Rad-' },
]

function formatTime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function HUD() {
  countRender('HUD')
  // Chrome only — low-frequency state. The high-frequency readouts live in
  // <FlightReadouts/>, which runs on its own throttled cadence (see below) so
  // per-tick sim writes don't re-render this whole component ~300x/s.
  const warpRate = useTrajectoriesStore((s) => s.warpRate)
  const bodies = useTrajectoriesStore((s) => s.bodies)
  const vehicles = useTrajectoriesStore((s) => s.vehicles)
  const followTargetId = useCameraStore((s) => s.followTargetId)
  const setFollowTarget = useCameraStore((s) => s.setFollowTarget)
  const activeView = useModeStore((s) => s.activeView)
  const showRotationAxes = useModeStore((s) => s.showRotationAxes)
  const showAttitudeDiagnostics = useModeStore((s) => s.showAttitudeDiagnostics)
  const toggleView = useModeStore((s) => s.toggleView)
  const toggleRotationAxes = useModeStore((s) => s.toggleRotationAxes)
  const toggleAttitudeDiagnostics = useModeStore((s) => s.toggleAttitudeDiagnostics)
  const perfLogging = useModeStore((s) => s.perfLogging)
  const togglePerfLogging = useModeStore((s) => s.togglePerfLogging)
  const targetName = bodies[followTargetId]?.name ?? vehicles[followTargetId]?.name ?? followTargetId

  function setWarp(rate: number) {
    useInputStore
      .getState()
      .push({ type: 'set-warp', rate, simTime: useTrajectoriesStore.getState().getSimTime() })
  }


  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: 16,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 14,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 32 }}>
        <div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>SIM TIME</div>
          <SimClock />
        </div>
        <div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>WARP</div>
          <div>{warpRate}x</div>
        </div>
        <div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>FOLLOWING</div>
          <div>{targetName}</div>
        </div>
        <div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>VIEW</div>
          <div>{activeView.toUpperCase()}</div>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        <select
          value={followTargetId}
          onChange={(e) => setFollowTarget(e.target.value)}
          style={{
            background: '#1a1a2e',
            color: '#ccc',
            border: '1px solid #333',
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          {Object.values(vehicles).length > 0 && (
            <optgroup label="Vehicles">
              {Object.values(vehicles).map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Bodies">
            {Object.values(bodies).map((body) => (
              <option key={body.id} value={body.id}>{body.name}</option>
            ))}
          </optgroup>
        </select>
        <button
          onClick={toggleView}
          style={{
            background: '#1a1a2e',
            color: '#ccc',
            border: '1px solid #333',
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Toggle View (V)
        </button>
        <button
          onClick={toggleRotationAxes}
          style={{
            background: showRotationAxes ? 'rgba(255,255,255,0.25)' : '#1a1a2e',
            color: '#ccc',
            border: '1px solid #333',
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Rotation Axis: {showRotationAxes ? 'On' : 'Off'}
        </button>
        <button
          onClick={toggleAttitudeDiagnostics}
          style={{
            background: showAttitudeDiagnostics ? 'rgba(255,255,255,0.25)' : '#1a1a2e',
            color: '#ccc',
            border: '1px solid #333',
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Attitude Diag: {showAttitudeDiagnostics ? 'On' : 'Off'}
        </button>
        <button
          onClick={togglePerfLogging}
          style={{
            background: perfLogging ? 'rgba(255,255,255,0.25)' : '#1a1a2e',
            color: '#ccc',
            border: '1px solid #333',
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Perf Log: {perfLogging ? 'On' : 'Off'}
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 4,
          pointerEvents: 'auto',
        }}
      >
        {WARP_RATES.map((rate) => (
          <button
            key={rate}
            onClick={() => setWarp(rate)}
            style={{
              padding: '2px 8px',
              background:
                rate === warpRate
                  ? 'rgba(100,180,255,0.35)'
                  : 'rgba(255,255,255,0.08)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            {rate}x
          </button>
        ))}
      </div>

      <div style={{ marginTop: 8, opacity: 0.4, fontSize: 11 }}>
        [ / ] warp &nbsp; Z/X throttle &nbsp; Ctrl+Z full &nbsp; Ctrl+X cut &nbsp; T SAS &nbsp; M map
        &nbsp; WASD/QE reaction wheel
        &nbsp; scroll to zoom &nbsp; drag to orbit &nbsp; esc menu
      </div>
      <FlightReadouts />
      <TooltipOverlay />
    </div>
  )
}

/** Sim-time readout on its own low-rate cadence (text needs no more). */
function SimClock() {
  useThrottledRender(8)
  return <div>T+ {formatTime(useTrajectoriesStore.getState().getSimTime())}</div>
}

/**
 * High-frequency flight readouts (navball, telemetry, maneuver, attitude diag)
 * on their own ~30Hz render cadence. Reads sim state via getState() instead of
 * subscribing, so per-tick worker writes don't re-render the HUD — the same
 * decoupling the 3D scene gets from useFrame.
 */
function FlightReadouts() {
  countRender('FlightReadouts')
  useThrottledRender(30)

  const traj = useTrajectoriesStore.getState()
  const simTime = traj.getSimTime()
  const { curves, bodies, vehicles, vehicleControls } = traj
  const firstVehicle = Object.values(vehicles)[0]
  if (!firstVehicle) return null

  const vehicleControl = vehicleControls[firstVehicle.id]
  const throttle = vehicleControl?.throttle ?? 0
  const vehicleCurve = curves[firstVehicle.id]
  const parent = bodies[firstVehicle.parentId]
  const parentCurve = curves[firstVehicle.parentId]
  const maneuverNodes = useManeuverStore.getState().nodes
  const node = maneuverNodes[firstVehicle.id]
  const activeAutopilotMode = useAutopilotStore.getState().modes[firstVehicle.id] ?? 'off'
  const showAttitudeDiagnostics = useModeStore.getState().showAttitudeDiagnostics

  const vehiclePosition = vehicleCurve ? evaluateCurve(vehicleCurve, simTime) : null
  const parentPosition = parentCurve ? evaluateCurve(parentCurve, simTime) : null
  const relativePosition = vehiclePosition && parentPosition
    ? [
        vehiclePosition[0] - parentPosition[0],
        vehiclePosition[1] - parentPosition[1],
        vehiclePosition[2] - parentPosition[2],
      ] as [number, number, number]
    : null
  const flightReadout = parent && vehicleCurve && parentCurve
    ? (() => {
        const vPos = vehiclePosition ?? evaluateCurve(vehicleCurve, simTime)
        const vVel = evaluateCurveVelocity(vehicleCurve, simTime)
        const pPos = parentPosition ?? evaluateCurve(parentCurve, simTime)
        const pVel = evaluateCurveVelocity(parentCurve, simTime)
        const relVel = [vVel[0] - pVel[0], vVel[1] - pVel[1], vVel[2] - pVel[2]] as [number, number, number]
        const parentRotationAxis = rotationAxisFromAxialTilt(parent.axialTilt)
        const frame = computeFlightReferenceFrame({
          relativePosition: [vPos[0] - pPos[0], vPos[1] - pPos[1], vPos[2] - pPos[2]],
          relativeVelocity: relVel,
          parentRadius: parent.radius,
          parentGm: parent.gm,
          parentAngularVelocity: parent.angularVelocity,
          parentRotationAxis,
          surfaceState: vehicleControl?.surfaceState ?? 'flying',
        })
        return {
          readout: computeFlightReadout({
            vehiclePosition: vPos,
            vehicleVelocity: vVel,
            parentPosition: pPos,
            parentVelocity: pVel,
            parentRadius: parent.radius,
            referenceVelocity: frame.navVelocity,
          }),
          frame,
          parentRotationAxis,
        }
      })()
    : null

  return (
    <>
      {showAttitudeDiagnostics && vehicleControl && (
        <AttitudeDiagnosticsPanel control={vehicleControl} />
      )}
      {node && (
        <ManeuverNodePanel
          vesselId={firstVehicle.id}
          node={node}
          simTime={simTime}
          mass={vehicleControl?.mass}
          maxThrust={vehicleControl?.maxThrust}
        />
      )}
      {vehicleControl && relativePosition && flightReadout && (
        <NavballCluster
          orientation={vehicleControl.orientation}
          relativePosition={relativePosition}
          relativeVelocity={flightReadout.frame.navVelocity}
          orbitNormal={flightReadout.frame.orbitNormal}
          parentRotationAxis={flightReadout.parentRotationAxis}
          onSelectMode={(mode) => useAutopilotStore.getState().toggleMode(firstVehicle.id, mode)}
          hasManeuverNode={!!node}
          mode={flightReadout.frame.mode}
          orbit={flightReadout.frame.orbit}
          throttle={throttle}
          forceRatio={computeForceLoadRatio({
            currentThrust: vehicleControl.currentThrust,
            aeroForceWorld: vehicleControl.aeroForceWorld,
            mass: vehicleControl.mass,
          })}
          surfaceState={vehicleControl.surfaceState}
          autopilotMode={activeAutopilotMode}
          maneuverDirection={node ? maneuverBurnDirection(node) ?? undefined : undefined}
          rows={flightTelemetryRows({
            readout: flightReadout.readout,
            throttle,
            angularVelocity: vehicleControl.angularVelocity,
            surfaceState: vehicleControl.surfaceState,
            autopilotMode: activeAutopilotMode,
            mass: vehicleControl.mass,
            maxThrust: vehicleControl.currentThrust ?? vehicleControl.maxThrust,
          })}
        />
      )}
    </>
  )
}

function AttitudeDiagnosticsPanel({ control }: { control: VehicleControlMeta }) {
  const rows = attitudeDiagnostics(control)
  if (!rows) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: 16,
        bottom: 16,
        width: 220,
        padding: 12,
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(120,200,255,0.4)',
        borderRadius: 4,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 12,
        pointerEvents: 'none',
      }}
    >
      <div style={{ color: '#78c8ff', fontWeight: 'bold', marginBottom: 8 }}>ATTITUDE CONTROL</div>
      {rows.map((row) => (
        <AttitudeAxisRow key={row.label} row={row} />
      ))}
      <div style={{ marginTop: 6, opacity: 0.5, fontSize: 10 }}>
        bar = commanded / max torque &nbsp; ω in °/s
      </div>
    </div>
  )
}

function AttitudeAxisRow({ row }: { row: AttitudeAxisDiagnostic }) {
  // Bar turns amber→red as the wheel approaches saturation.
  const hue = 140 - row.saturation * 140
  const rateDegPerSec = (row.angularRate * 180) / Math.PI
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
        <span>{row.label}</span>
        <span style={{ opacity: 0.7 }}>
          {(row.saturation * 100).toFixed(0)}% &nbsp; {rateDegPerSec >= 0 ? '+' : ''}
          {rateDegPerSec.toFixed(1)}°/s
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.12)', borderRadius: 3, overflow: 'hidden' }}>
        <div
          style={{
            width: `${row.saturation * 100}%`,
            height: '100%',
            background: `hsl(${hue}, 80%, 55%)`,
          }}
        />
      </div>
    </div>
  )
}

interface ManeuverNodePanelProps {
  vesselId: string
  node: ManeuverNode
  simTime: number
  mass?: number
  maxThrust?: number
}

function ManeuverNodePanel({ vesselId, node, simTime, mass, maxThrust }: ManeuverNodePanelProps) {
  const updateDeltaV = useManeuverStore((s) => s.updateDeltaV)
  const clearNode = useManeuverStore((s) => s.clearNode)
  const dt = node.simTime - simTime
  const totalDeltaV = Math.hypot(node.deltaV.prograde, node.deltaV.normal, node.deltaV.radial)
  const burnDuration =
    totalDeltaV > 0 && mass && maxThrust && maxThrust > 0
      ? (totalDeltaV * mass) / maxThrust
      : null

  // Use refs so the hold-to-repeat callbacks always see the latest deltaV
  // instead of capturing stale values from when the button was first pressed.
  const deltaVRef = useRef(node.deltaV)
  useEffect(() => {
    deltaVRef.current = node.deltaV
  })
  const adjust = (key: keyof ManeuverDeltaV, delta: number) => {
    updateDeltaV(vesselId, { [key]: deltaVRef.current[key] + delta })
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 16,
        top: 96,
        width: 240,
        padding: 12,
        background: 'rgba(0,0,0,0.6)',
        border: '1px solid rgba(255,204,0,0.4)',
        borderRadius: 4,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 12,
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ color: '#ffcc00', fontWeight: 'bold' }}>MANEUVER NODE</div>
        <button
          onClick={() => clearNode(vesselId)}
          style={{
            background: 'transparent',
            color: '#ff7777',
            border: '1px solid #883333',
            borderRadius: 3,
            padding: '0 6px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ opacity: 0.7, fontSize: 11 }}>
        {dt >= 0 ? `T- ${formatTime(dt)}` : `passed ${formatTime(-dt)} ago`}
      </div>
      <div style={{ marginTop: 4, fontSize: 11 }}>
        Total ΔV: <span style={{ color: '#ffcc00' }}>{totalDeltaV.toFixed(1)} m/s</span>
      </div>
      {burnDuration !== null && (
        <div style={{ marginTop: 2, fontSize: 11 }}>
          Burn time: <span style={{ color: '#ffcc00' }}>{formatBurnDuration(burnDuration)}</span>
        </div>
      )}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {DELTA_V_AXES.map(({ key, positive, negative }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 56, opacity: 0.7 }}>{positive}/{negative}</div>
            <HoldButton onAction={() => adjust(key, -10)}>−10</HoldButton>
            <HoldButton onAction={() => adjust(key, -1)}>−1</HoldButton>
            <div style={{ flex: 1, textAlign: 'center', color: node.deltaV[key] !== 0 ? '#ffcc00' : '#ccc' }}>
              {node.deltaV[key].toFixed(1)}
            </div>
            <HoldButton onAction={() => adjust(key, 1)}>+1</HoldButton>
            <HoldButton onAction={() => adjust(key, 10)}>+10</HoldButton>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatBurnDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '∞'
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  return formatTime(seconds)
}

const HOLD_DELAY_MS = 250
const HOLD_INTERVAL_MS = 60

function HoldButton({ onAction, children }: { onAction: () => void; children: ReactNode }) {
  // Repeat onAction while the pointer is held: one immediate call, then
  // accelerating repeats after an initial delay.
  const actionRef = useRef(onAction)
  useEffect(() => {
    actionRef.current = onAction
  })
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = () => {
    if (delayTimer.current !== null) {
      clearTimeout(delayTimer.current)
      delayTimer.current = null
    }
    if (intervalTimer.current !== null) {
      clearInterval(intervalTimer.current)
      intervalTimer.current = null
    }
  }

  const start = () => {
    stop()
    actionRef.current()
    delayTimer.current = setTimeout(() => {
      intervalTimer.current = setInterval(() => actionRef.current(), HOLD_INTERVAL_MS)
    }, HOLD_DELAY_MS)
  }

  useEffect(() => stop, [])

  return (
    <button
      onPointerDown={(event) => {
        event.preventDefault()
        ;(event.target as HTMLButtonElement).setPointerCapture(event.pointerId)
        start()
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      onBlur={stop}
      style={deltaButtonStyle}
    >
      {children}
    </button>
  )
}

const deltaButtonStyle: CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  color: 'white',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 3,
  padding: '2px 4px',
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 10,
  minWidth: 28,
}
