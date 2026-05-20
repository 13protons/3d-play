import {
  computeNavballState,
  shouldRenderNavballMarker,
  visibleNavballSegments,
  type Quaternion,
  type Vec3,
} from './navballMath'
import type { FlightTelemetryRow } from './flightReadout'
import type { FlightReferenceMode } from '../sim/vehicle/referenceFrame'

interface NavballProps {
  orientation: Quaternion
  relativePosition: Vec3
  relativeVelocity: Vec3
  mode: FlightReferenceMode
}

interface NavballClusterProps extends NavballProps {
  rows: FlightTelemetryRow[]
}

const RADIUS = 76
const SIZE = 184
const CENTER = SIZE / 2

const markerStyles = {
  prograde: { label: 'P', color: '#9cff8f' },
  retrograde: { label: 'R', color: '#ff9a8f' },
  radialOut: { label: 'RO', color: '#8fd8ff' },
  radialIn: { label: 'RI', color: '#ffcf70' },
  normal: { label: 'N', color: '#d4a4ff' },
  antiNormal: { label: 'AN', color: '#b8b8ff' },
} as const

export function Navball({ orientation, relativePosition, relativeVelocity, mode }: NavballProps) {
  const state = computeNavballState({
    orientation,
    relativePosition,
    relativeVelocity,
    radius: RADIUS,
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
        <circle cx={CENTER} cy={CENTER} r={RADIUS + 7} fill="rgba(0,0,0,0.55)" />
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="url(#navball-shade)" stroke="#d9e3ff" strokeWidth="2" />
        <g clipPath="url(#navball-clip)">
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="rgba(70,95,140,0.35)" />
          {horizonPaths.map((path, index) => (
            <path key={index} d={path} fill="none" stroke="#f3f0d0" strokeWidth="2" strokeDasharray="6 5" opacity="0.8" />
          ))}
          <line x1={CENTER - RADIUS} y1={CENTER} x2={CENTER + RADIUS} y2={CENTER} stroke="rgba(255,255,255,0.14)" />
          <line x1={CENTER} y1={CENTER - RADIUS} x2={CENTER} y2={CENTER + RADIUS} stroke="rgba(255,255,255,0.14)" />
          {Object.entries(state.markers).map(([key, point]) => {
            const style = markerStyles[key as keyof typeof markerStyles]
            if (!shouldRenderNavballMarker(point)) return null
            return (
              <g
                key={key}
                transform={`translate(${CENTER + point.x} ${CENTER + point.y})`}
              >
                <circle r={key === 'prograde' || key === 'retrograde' ? 8 : 6} fill="rgba(0,0,0,0.65)" stroke={style.color} strokeWidth="2" />
                <text y="3" textAnchor="middle" fontFamily="monospace" fontSize="8" fill={style.color}>
                  {style.label}
                </text>
              </g>
            )
          })}
        </g>
        <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
        <g stroke="#ffffff" strokeWidth="2" strokeLinecap="round">
          <line x1={CENTER - 14} y1={CENTER} x2={CENTER - 4} y2={CENTER} />
          <line x1={CENTER + 4} y1={CENTER} x2={CENTER + 14} y2={CENTER} />
          <line x1={CENTER} y1={CENTER - 14} x2={CENTER} y2={CENTER - 4} />
          <line x1={CENTER} y1={CENTER + 4} x2={CENTER} y2={CENTER + 14} />
        </g>
        <text x={CENTER} y={SIZE - 8} textAnchor="middle" fontFamily="monospace" fontSize="10" fill="rgba(255,255,255,0.65)">
          {mode === 'surface' ? 'SURF NAV' : 'ORBIT NAV'}
        </text>
      </svg>
    </div>
  )
}

export function NavballCluster({
  orientation,
  relativePosition,
  relativeVelocity,
  rows,
  mode,
}: NavballClusterProps) {
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 12,
        pointerEvents: 'none',
      }}
    >
      <TelemetryPanel rows={rows.slice(0, 3)} align="right" />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <div
          style={{
            marginBottom: 4,
            padding: '2px 8px',
            border: '1px solid rgba(210,225,255,0.28)',
            borderRadius: 999,
            background: mode === 'surface' ? 'rgba(255,170,80,0.2)' : 'rgba(100,180,255,0.16)',
            color: 'rgba(255,255,255,0.75)',
            fontFamily: 'monospace',
            fontSize: 10,
            letterSpacing: 0.8,
          }}
        >
          {mode === 'surface' ? 'SURFACE MODE' : 'ORBITAL MODE'}
        </div>
        <Navball orientation={orientation} relativePosition={relativePosition} relativeVelocity={relativeVelocity} mode={mode} />
      </div>
      <TelemetryPanel rows={rows.slice(3)} align="left" />
    </div>
  )
}

function TelemetryPanel({ rows, align }: { rows: FlightTelemetryRow[]; align: 'left' | 'right' }) {
  return (
    <div
      style={{
        minWidth: 116,
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
          <span style={{ color: 'rgba(255,255,255,0.5)' }}>{row.label}</span>
          <span>{row.value}</span>
        </div>
      ))}
    </div>
  )
}
