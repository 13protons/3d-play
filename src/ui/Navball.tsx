import {
  computeNavballState,
  shouldRenderNavballMarker,
  visibleNavballSegments,
  type Quaternion,
  type Vec3,
} from './navballMath'
import { computeArcProgressPath } from './navballInstrumentMath'
import {
  MARKER_ICONS, MARKER_COLORS, MARKER_LABELS, HOLD_MODE_ICONS, HOLD_MODE_COLORS,
  STATE_ICONS, STATE_COLORS, STATE_LABELS, ORBIT_ICONS, ORBIT_COLORS, ORBIT_LABELS,
  FRAME_ICONS, FRAME_COLORS, FRAME_LABELS,
} from './navIcons'
import type { NavGlyph } from './navGlyphs'
import { hoverTooltip } from './tooltipStore'
import { formatFlightNumber, type FlightTelemetryRow } from './flightReadout'
import type { FlightReferenceMode, OrbitSummary } from '../sim/vehicle/referenceFrame'
import type { AutopilotMode } from '../sim/autopilot'

interface NavballProps {
  orientation: Quaternion
  relativePosition: Vec3
  relativeVelocity: Vec3
  parentRotationAxis: Vec3
  mode: FlightReferenceMode
  maneuverDirection?: Vec3
  /** True orbital-plane normal (inertial). Used for the normal markers so they
   * stay correct near the surface where the surface-relative velocity ≈ 0. */
  orbitNormal?: Vec3
}

interface NavballClusterProps extends NavballProps {
  rows: FlightTelemetryRow[]
  throttle: number
  forceRatio: number
  surfaceState: SurfaceState
  autopilotMode: AutopilotMode
  orbit?: OrbitSummary
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
                {...hoverTooltip(MODE_TITLES[mode] ?? mode)}
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
                <GlyphIcon glyph={Glyph} size={22} color={isActive ? '#0a0e1c' : color} />
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** Vehicle-status indicators stacked beside the navball (frame, orbit, state),
 * mirroring the autopilot column on the other side. Non-interactive badges. */
export function StatusColumn({
  mode,
  orbit,
  surfaceState,
}: {
  mode: FlightReferenceMode
  orbit?: OrbitSummary
  surfaceState: SurfaceState
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7, alignItems: 'center', pointerEvents: 'auto' }}>
      <StatusBadge glyph={FRAME_ICONS[mode]} color={FRAME_COLORS[mode]} title={FRAME_LABELS[mode]} />
      {orbit && <StatusBadge glyph={ORBIT_ICONS[orbit.kind]} color={ORBIT_COLORS[orbit.kind]} title={ORBIT_LABELS[orbit.kind]} />}
      <StatusBadge glyph={STATE_ICONS[surfaceState]} color={STATE_COLORS[surfaceState]} title={STATE_LABELS[surfaceState]} />
    </div>
  )
}

function StatusBadge({ glyph, color, title }: { glyph: NavGlyph; color: string; title: string }) {
  return (
    <div
      {...hoverTooltip(title)}
      role="img"
      aria-label={title}
      style={{
        width: 24,
        height: 24,
        boxSizing: 'border-box',
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(10,16,28,0.78)',
        border: '1px solid rgba(255,255,255,0.22)',
      }}
    >
      <GlyphIcon glyph={glyph} size={20} color={color} />
    </div>
  )
}

interface NavballInstrumentProps extends NavballProps {
  throttle: number
  forceRatio: number
  surfaceState: SurfaceState
  autopilotMode: AutopilotMode
  orbit?: OrbitSummary
  /** Values shown on the bottom shelf (ALT/VEL), mirroring AP/PE on top. */
  bottomRows?: FlightTelemetryRow[]
}

/** Full names for the bottom-shelf abbreviations (hover tooltips). */
const BOTTOM_SHELF_TITLES: Record<string, string> = {
  ALT: 'Altitude',
  VEL: 'Velocity',
  VERT: 'Vertical speed',
}

interface ProximityProps {
  rows: FlightTelemetryRow[]
}

interface AttitudeProps {
  rows: FlightTelemetryRow[]
}

type SurfaceState = 'flying' | 'landed' | 'crashed'

const RADIUS = 85
const VISIBLE_RADIUS = 83.5
const SIZE = 170
const CENTER = SIZE / 2

export function Navball({ orientation, relativePosition, relativeVelocity, parentRotationAxis, maneuverDirection, orbitNormal }: NavballProps) {
  const state = computeNavballState({
    orientation,
    relativePosition,
    relativeVelocity,
    parentRotationAxis,
    radius: RADIUS,
    maneuverDirection,
    orbitNormal,
  })
  const toPath = (segment: { x: number; y: number }[]) => segment
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${CENTER + point.x} ${CENTER + point.y}`)
    .join(' ')
  const horizonPaths = visibleNavballSegments(state.horizon)
    .filter((segment) => segment.length > 1)
    .map(toPath)
  const meridianPaths = state.meridians.flatMap((meridian) =>
    visibleNavballSegments(meridian).filter((segment) => segment.length > 1).map(toPath),
  )
  const skyPath = state.sky.length > 1 ? `${toPath(state.sky)} Z` : null

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
          {/* Attitude-indicator shading: brown ground base, blue sky hemisphere
              following the curved horizon (toward radial-out). */}
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill="rgba(120,80,46,0.5)" />
          {skyPath && <path d={skyPath} fill="rgba(60,116,170,0.5)" />}
          {horizonPaths.map((path, index) => (
            <path key={index} d={path} fill="none" stroke="#f3f0d0" strokeWidth="2" strokeDasharray="6 5" opacity="0.8" />
          ))}
          {meridianPaths.map((path, index) => (
            <path key={`meridian-${index}`} d={path} fill="none" stroke="rgba(217,227,255,0.18)" strokeWidth="1" />
          ))}
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
                style={{ pointerEvents: 'auto' }}
                {...(MARKER_LABELS[key] ? hoverTooltip(MARKER_LABELS[key]) : {})}
              >
                {MARKER_LABELS[key] && <title>{MARKER_LABELS[key]}</title>}
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
  orbitNormal,
  orbit,
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
        zIndex: 10, // keep the cluster (and its hover targets) above the 3D canvas
      }}
    >
      <Proximity rows={rows.slice(2, 3)} />
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
        orbitNormal={orbitNormal}
        orbit={orbit}
        bottomRows={rows.slice(0, 2)}
      />
      <StatusColumn mode={mode} orbit={orbit} surfaceState={surfaceState} />
      <Attitude rows={rows.slice(3)} />
    </div>
  )
}

export function NavballInstrument(props: NavballInstrumentProps) {
  const { throttle, forceRatio, orbit, bottomRows = [] } = props
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
      <div style={{ position: 'absolute', left: 10, top: 5 }}>
        <Navball {...props} />
      </div>
      {/* Top shelf: apoapsis then periapsis. */}
      {orbit && (() => {
        const ap = orbit.apoapsisAltitude === null ? '--' : formatFlightNumber(orbit.apoapsisAltitude, 'm')
        const pe = orbit.periapsisAltitude < 0 ? '--' : formatFlightNumber(orbit.periapsisAltitude, 'm')
        return (
          <Shelf top={-2}>
            <ShelfValue label="AP" value={ap} title={`Apoapsis: ${ap}`} />
            <ShelfValue label="PE" value={pe} title={`Periapsis: ${pe}`} />
          </Shelf>
        )
      })()}
      {/* Bottom shelf: altitude then speed (mirrors AP/PE on top). */}
      {bottomRows.length > 0 && (
        <Shelf top={176}>
          {bottomRows.map((row) => (
            <ShelfValue
              key={row.label}
              label={row.label}
              value={row.value}
              title={`${BOTTOM_SHELF_TITLES[row.label] ?? row.label}: ${row.value}`}
            />
          ))}
        </Shelf>
      )}
    </div>
  )
}

/** Render a navball glyph as a standalone HTML icon, with a hover tooltip. */
function GlyphIcon({ glyph: Glyph, size, color, title }: { glyph: NavGlyph; size: number; color: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-12 -12 24 24"
      aria-label={title}
      focusable={false}
      {...(title ? hoverTooltip(title) : {})}
    >
      {title && <title>{title}</title>}
      <Glyph color={color} />
    </svg>
  )
}

/** A small panel that slightly overlaps the navball's top or bottom edge. */
function Shelf({ top, children }: { top: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '2px 9px',
        background: 'rgba(5,8,18,0.82)',
        border: '1px solid rgba(210,225,255,0.22)',
        borderRadius: 10,
        whiteSpace: 'nowrap',
        pointerEvents: 'auto', // so the per-item hover tooltips register
      }}
    >
      {children}
    </div>
  )
}

function ShelfValue({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span {...(title ? hoverTooltip(title) : {})} style={{ fontSize: 9, color: 'rgba(210,250,255,0.62)' }}>
      {label} <span style={{ color: 'rgba(255,205,112,0.94)' }}>{value}</span>
    </span>
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

export function Proximity({ rows }: ProximityProps) {
  return <TelemetryPanel rows={rows} align="right" />
}

export function Attitude({ rows }: AttitudeProps) {
  return <TelemetryPanel rows={rows} align="left" />
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
