import type { CSSProperties } from 'react'
import {
  computeNavballState,
  shouldRenderNavballMarker,
  visibleNavballSegments,
  type Quaternion,
  type Vec3,
} from './navballMath'
import { computeArcProgressPath } from './navballInstrumentMath'
import { MARKER_ICONS, MARKER_COLORS, HOLD_MODE_ICONS, HOLD_MODE_COLORS } from './navIcons'
import type { FlightTelemetryRow } from './flightReadout'
import type { FlightReferenceMode } from '../sim/vehicle/referenceFrame'
import type { AutopilotMode } from '../sim/autopilot'

interface NavballProps {
  orientation: Quaternion
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentRotationAxis: Vec3
  mode: FlightReferenceMode
  maneuverDirection?: Vec3
}

interface NavballClusterProps extends NavballProps {
  rows: FlightTelemetryRow[]
  throttle: number
  forceRatio: number
  surfaceState: SurfaceState
  autopilotMode: AutopilotMode
  onSelectMode?: (mode: AutopilotMode) => void
  hasManeuverNode?: boolean
}

/** Autopilot modes as matched +/- pairs (top to bottom), Hold and Man as singles. */
const AUTOPILOT_GROUPS: AutopilotMode[][] = [
  ['damp'],
  ['prograde', 'retrograde'],
  ['normal', 'antinormal'],
  ['radial-out', 'radial-in'],
  ['maneuver'],
]

const MODE_TITLES: Record<string, string> = {
  damp: 'Hold (kill rotation)',
  prograde: 'Prograde',
  retrograde: 'Retrograde',
  normal: 'Normal',
  antinormal: 'Anti-normal',
  'radial-out': 'Radial out',
  'radial-in': 'Radial in',
  maneuver: 'Maneuver',
}

function AutopilotColumn({
  active,
  hasNode,
  onSelect,
}: {
  active: AutopilotMode
  hasNode: boolean
  onSelect: (mode: AutopilotMode) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', pointerEvents: 'auto' }}>
      {AUTOPILOT_GROUPS.map((group, index) => (
        <div key={index} style={{ display: 'flex', gap: 4 }}>
          {group.map((mode) => {
            if (mode === 'maneuver' && !hasNode) return null
            const Glyph = HOLD_MODE_ICONS[mode]
            if (!Glyph) return null
            const color = HOLD_MODE_COLORS[mode] ?? '#cfe0ff'
            const isActive = active === mode
            return (
              <button
                key={mode}
                onClick={() => onSelect(mode)}
                title={MODE_TITLES[mode] ?? mode}
                style={{
                  width: 24,
                  height: 24,
                  boxSizing: 'border-box',
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  padding: 0,
                  cursor: 'pointer',
                  background: isActive ? color : 'rgba(10,16,28,0.78)',
                  border: `1px solid ${isActive ? color : 'rgba(255,255,255,0.22)'}`,
                }}
              >
                <svg width={22} height={22} viewBox="-12 -12 24 24" aria-hidden focusable={false}>
                  <Glyph color={isActive ? '#0a0e1c' : color} />
                </svg>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

interface NavballInstrumentProps extends NavballProps {
  throttle: number
  forceRatio: number
  surfaceState: SurfaceState
  autopilotMode: AutopilotMode
}

interface ProximityProps {
  rows: FlightTelemetryRow[]
}

interface AttitudeProps {
  rows: FlightTelemetryRow[]
  surfaceState?: SurfaceState
}

type SurfaceState = 'flying' | 'landed' | 'crashed'

const RADIUS = 85
const VISIBLE_RADIUS = 83.5
const SIZE = 170
const CENTER = SIZE / 2

export function Navball({ orientation, relativePosition, relativeVelocity, parentRotationAxis, maneuverDirection }: NavballProps) {
  const state = computeNavballState({
    orientation,
    relativePosition,
    relativeVelocity,
    parentRotationAxis,
    radius: RADIUS,
    maneuverDirection,
  })
  const horizonPaths = visibleNavballSegments(state.horizon)
    .filter((segment) => segment.length > 1)
    .map((segment) => segment
      .map((point, index) => `${index === 0 ? 'M' : 'L'} ${CENTER + point.x} ${CENTER + point.y}`)
      .join(' '))

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        pointerEvents: 'none',
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Orbital navball">
        <defs>
          <clipPath id="navball-clip">
            <circle cx={CENTER} cy={CENTER} r={RADIUS} />
          </clipPath>
          <radialGradient id="navball-shade" cx="35%" cy="25%" r="70%">
            <stop offset="0%" stopColor="#34476b" />
            <stop offset="55%" stopColor="#17233e" />
            <stop offset="100%" stopColor="#050912" />
          </radialGradient>
        </defs>
        <circle cx={CENTER} cy={CENTER} r={VISIBLE_RADIUS} fill="url(#navball-shade)" stroke="#d9e3ff" strokeWidth="2" />
        <g clipPath="url(#navball-clip)">
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="rgba(70,95,140,0.35)" />
          {horizonPaths.map((path, index) => (
            <path key={index} d={path} fill="none" stroke="#f3f0d0" strokeWidth="2" strokeDasharray="6 5" opacity="0.8" />
          ))}
          <line x1={CENTER - RADIUS} y1={CENTER} x2={CENTER + RADIUS} y2={CENTER} stroke="rgba(255,255,255,0.14)" />
          <line x1={CENTER} y1={CENTER - RADIUS} x2={CENTER} y2={CENTER + RADIUS} stroke="rgba(255,255,255,0.14)" />
          {state.compass && Object.entries(state.compass).map(([key, point]) => {
            if (!point.visible) return null
            const label = key[0].toUpperCase()
            const length = 8
            const magnitude = Math.hypot(point.x, point.y) || 1
            const ux = point.x / magnitude
            const uy = point.y / magnitude

            return (
              <g key={key} opacity="0.72">
                <line
                  x1={CENTER + point.x - ux * length}
                  y1={CENTER + point.y - uy * length}
                  x2={CENTER + point.x}
                  y2={CENTER + point.y}
                  stroke="rgba(220,235,255,0.65)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <text
                  x={CENTER + point.x - ux * (length + 7)}
                  y={CENTER + point.y - uy * (length + 7) + 3}
                  textAnchor="middle"
                  fontFamily="monospace"
                  fontSize="7"
                  fill="rgba(220,235,255,0.72)"
                >
                  {label}
                </text>
              </g>
            )
          })}
          {Object.entries(state.markers).map(([key, point]) => {
            if (!shouldRenderNavballMarker(point)) return null
            const Glyph = MARKER_ICONS[key]
            if (!Glyph) return null
            const color = MARKER_COLORS[key] ?? '#d9e3ff'
            return (
              <g
                key={key}
                transform={`translate(${CENTER + point.x} ${CENTER + point.y}) scale(0.85)`}
              >
                <circle r={11} fill="rgba(0,0,0,0.55)" />
                <Glyph color={color} />
              </g>
            )
          })}
        </g>
        <circle cx={CENTER} cy={CENTER} r={VISIBLE_RADIUS} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
        <g stroke="#ffffff" strokeWidth="2" strokeLinecap="round">
          <line x1={CENTER - 14} y1={CENTER} x2={CENTER - 4} y2={CENTER} />
          <line x1={CENTER + 4} y1={CENTER} x2={CENTER + 14} y2={CENTER} />
          <line x1={CENTER} y1={CENTER - 14} x2={CENTER} y2={CENTER - 4} />
          <line x1={CENTER} y1={CENTER + 4} x2={CENTER} y2={CENTER + 14} />
        </g>
      </svg>
    </div>
  )
}

export function NavballCluster({
  orientation,
  relativePosition,
  relativeVelocity,
  parentRotationAxis,
  rows,
  mode,
  throttle,
  forceRatio,
  surfaceState,
  autopilotMode,
  maneuverDirection,
  onSelectMode,
  hasManeuverNode,
}: NavballClusterProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        pointerEvents: 'none',
      }}
    >
      <Proximity rows={rows.slice(0, 3)} />
      {onSelectMode && (
        <AutopilotColumn active={autopilotMode} hasNode={!!hasManeuverNode} onSelect={onSelectMode} />
      )}
      <NavballInstrument
        orientation={orientation}
        relativePosition={relativePosition}
        relativeVelocity={relativeVelocity}
        parentRotationAxis={parentRotationAxis}
        mode={mode}
        throttle={throttle}
        forceRatio={forceRatio}
        surfaceState={surfaceState}
        autopilotMode={autopilotMode}
        maneuverDirection={maneuverDirection}
      />
      <Attitude rows={rows.slice(3)} surfaceState={surfaceState} />
    </div>
  )
}

export function NavballInstrument(props: NavballInstrumentProps) {
  const { mode, throttle, forceRatio, autopilotMode } = props
  const throttleArc = computeArcProgressPath({ value: throttle, radius: 90, cx: 95, cy: 90, startDegrees: 135, endDegrees: 45 })
  const forceArc = computeArcProgressPath({ value: forceRatio, radius: 90, cx: 95, cy: 90, startDegrees: 135, endDegrees: 45, mirror: true })
  return (
    <div
      style={{
        position: 'relative',
        width: 190,
        height: 202,
        fontFamily: 'monospace',
        pointerEvents: 'none',
      }}
    >
      <svg
        width="190"
        height="180"
        viewBox="0 0 190 180"
        aria-hidden="true"
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <InstrumentArc indicator="force" paths={forceArc} />
        <InstrumentArc indicator="throttle" paths={throttleArc} />
      </svg>
      <StatusPad label={flightRegimeLabel(mode)} style={{ left: 5, top: 0 }} />
      <StatusPad label={autopilotModeLabel(autopilotMode)} style={{ right: 5, top: 0 }} />
      <StatusPad style={{ left: 5, top: 156 }} />
      <StatusPad style={{ right: 5, top: 156 }} />
      <div style={{ position: 'absolute', left: 10, top: 5 }}>
        <Navball {...props} />
      </div>
    </div>
  )
}

function InstrumentArc({
  indicator,
  paths,
}: {
  indicator: 'force' | 'throttle'
  paths: { trackPath: string; progressPath: string }
}) {
  return (
    <g data-indicator={indicator}>
      <path d={paths.trackPath} fill="none" stroke="#406568" strokeWidth="6" />
      <path d={paths.progressPath} fill="none" stroke="#ffc260" strokeWidth="6" />
    </g>
  )
}

function StatusPad({ label, style }: { label?: string; style: CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        width: 24,
        height: 24,
        borderRadius: 999,
        display: 'grid',
        placeItems: 'center',
        background: '#406568',
        color: '#ffc260',
        fontSize: 7,
        fontWeight: 700,
        letterSpacing: 0.4,
        ...style,
      }}
    >
      {label}
    </div>
  )
}

function flightRegimeLabel(mode: FlightReferenceMode) {
  return mode === 'surface' ? 'SUR' : 'ORB'
}

function surfaceStateLabel(surfaceState: SurfaceState) {
  if (surfaceState === 'landed') return 'LAND'
  if (surfaceState === 'crashed') return 'CRASH'
  return 'FLY'
}

function autopilotModeLabel(mode: AutopilotMode): string {
  switch (mode) {
    case 'damp': return 'HOLD'
    case 'prograde': return 'PRO'
    case 'retrograde': return 'RETRO'
    case 'normal': return 'NORM'
    case 'antinormal': return 'ANTI'
    case 'radial-out': return 'RAD+'
    case 'radial-in': return 'RAD-'
    case 'maneuver': return 'MNV'
    default: return 'MAN'
  }
}

export function Proximity({ rows }: ProximityProps) {
  return <TelemetryPanel rows={rows} align="right" />
}

export function Attitude({ rows, surfaceState }: AttitudeProps) {
  const stateRows = surfaceState ? [{ label: 'STATE', value: surfaceStateLabel(surfaceState) }, ...rows] : rows
  return <TelemetryPanel rows={stateRows} align="left" />
}

function TelemetryPanel({ rows, align }: { rows: FlightTelemetryRow[]; align: 'left' | 'right' }) {
  return (
    <div
      style={{
        boxSizing: 'border-box',
        width: 180,
        padding: '8px 10px',
        marginBottom: 22,
        border: '1px solid rgba(210,225,255,0.28)',
        borderRadius: 8,
        background: 'rgba(5,8,18,0.68)',
        boxShadow: '0 0 18px rgba(0,0,0,0.35)',
        fontFamily: 'monospace',
        fontSize: 11,
        color: 'white',
        textAlign: align,
      }}
    >
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: 'rgba(210,250,255,0.62)' }}>{row.label}</span>
          <span style={{ color: 'rgba(255,205,112,0.94)' }}>{row.value}</span>
        </div>
      ))}
    </div>
  )
}
