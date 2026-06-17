import {
  computeNavballState,
  shouldRenderNavballMarker,
  visibleNavballSegments,
  type Quaternion,
  type Vec3,
} from './navballMath';
import { computeArcProgressPath } from './navballInstrumentMath';
import {
  MARKER_ICONS,
  MARKER_COLORS,
  MARKER_LABELS,
  HOLD_MODE_ICONS,
  HOLD_MODE_COLORS,
  STATE_ICONS,
  STATE_COLORS,
  STATE_LABELS,
  ORBIT_ICONS,
  ORBIT_COLORS,
  ORBIT_LABELS,
} from './navIcons';
import type { NavGlyph } from './navGlyphs';
import { hoverTooltip } from './tooltipStore';
import { formatFlightNumber, type FlightTelemetryRow } from './flightReadout';
import type { FlightReferenceMode, OrbitSummary } from '../sim/vehicle/referenceFrame';
import type { AutopilotMode } from '../sim/autopilot';

interface NavballProps {
  orientation: Quaternion;
  relativePosition: Vec3;
  relativeVelocity: Vec3;
  parentRotationAxis: Vec3;
  mode: FlightReferenceMode;
  maneuverDirection?: Vec3;
  /** True orbital-plane normal (inertial). Used for the normal markers so they
   * stay correct near the surface where the surface-relative velocity ≈ 0. */
  orbitNormal?: Vec3;
}

interface NavballClusterProps extends NavballProps {
  rows: FlightTelemetryRow[];
  throttle: number;
  forceRatio: number;
  /** Ambient atmospheric density ratio (0 = vacuum, 1 = surface). */
  atmosphereRatio: number;
  surfaceState: SurfaceState;
  autopilotMode: AutopilotMode;
  orbit?: OrbitSummary;
  onSelectMode?: (mode: AutopilotMode) => void;
  hasManeuverNode?: boolean;
}

const MODE_TITLES: Record<string, string> = {
  'damp': 'Hold (kill rotation)',
  'prograde': 'Prograde',
  'retrograde': 'Retrograde',
  'normal': 'Normal',
  'antinormal': 'Anti-normal',
  'radial-out': 'Radial out',
  'radial-in': 'Radial in',
  'maneuver': 'Maneuver',
};

// --- Circular icon cell --------------------------------------------------
// Sizing knobs for every round icon beside the navball (autopilot buttons +
// status badges). Tweak these two numbers to dial the whole set in:
const CIRCLE_DIAMETER = 24; // outer diameter of the round cell, px
const CIRCLE_GLYPH_SIZE = 16; // glyph size inside the cell, px (smaller = more padding)
// Right-side status badges: a bit smaller than the autopilot buttons.
const STATUS_DIAMETER = 20;
const STATUS_GLYPH_SIZE = 13;

/** A round icon cell shared by the autopilot column and the status column.
 * Pass `onSelect` to make it an interactive button; omit it for a static
 * (non-interactive) badge. `active` fills the cell with its accent color.
 * `diameter`/`glyphSize` override the default sizing per call site. */
function CircleIcon({
  glyph,
  color,
  title,
  active = false,
  disabled = false,
  diameter = CIRCLE_DIAMETER,
  glyphSize = CIRCLE_GLYPH_SIZE,
  onSelect,
}: {
  glyph: NavGlyph;
  color: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  diameter?: number;
  glyphSize?: number;
  onSelect?: () => void;
}) {
  const cell = {
    width: diameter,
    height: diameter,
    boxSizing: 'border-box' as const,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center' as const,
    background: active ? color : 'rgba(10,16,28,0.78)',
    border: `1px solid ${active ? color : 'rgba(255,255,255,0.22)'}`,
    opacity: disabled ? 0.3 : 1,
  };
  const glyphColor = active ? '#0a0e1c' : color;
  const inner = (
    <GlyphIcon
      glyph={glyph}
      size={glyphSize}
      color={glyphColor}
    />
  );
  if (onSelect) {
    return (
      <button
        onClick={onSelect}
        disabled={disabled}
        {...hoverTooltip(title)}
        style={{ ...cell, padding: 0, cursor: disabled ? 'not-allowed' : 'pointer' }}
      >
        {inner}
      </button>
    );
  }
  return (
    <div
      {...hoverTooltip(title)}
      role='img'
      aria-label={title}
      style={cell}
    >
      {inner}
    </div>
  );
}

function AutopilotColumn({
  active,
  hasNode,
  flying,
  onSelect,
}: {
  active: AutopilotMode;
  hasNode: boolean;
  flying: boolean;
  onSelect: (mode: AutopilotMode) => void;
}) {
  // Each button is rendered explicitly so individual icons/rows are easy to
  // reposition. Rows: Hold, prograde/retrograde, normal/antinormal,
  // radial out/in, maneuver. Hold is always available; the steering modes
  // only while flying; maneuver also needs a node.
  const rowStyle = { display: 'flex', gap: 4 } as const;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 7,
        alignItems: 'end',
        pointerEvents: 'auto',
      }}
    >
      <div style={rowStyle}>
        <CircleIcon
          glyph={HOLD_MODE_ICONS.damp!}
          color={HOLD_MODE_COLORS.damp!}
          title={MODE_TITLES.damp}
          active={active === 'damp'}
          onSelect={() => onSelect('damp')}
        />
      </div>
      <div style={{ paddingRight: '.8em', ...rowStyle }}>
        <CircleIcon
          glyph={HOLD_MODE_ICONS.prograde!}
          color={HOLD_MODE_COLORS.prograde!}
          title={MODE_TITLES.prograde}
          active={active === 'prograde'}
          disabled={!flying}
          onSelect={() => onSelect('prograde')}
        />
        <CircleIcon
          glyph={HOLD_MODE_ICONS.retrograde!}
          color={HOLD_MODE_COLORS.retrograde!}
          title={MODE_TITLES.retrograde}
          active={active === 'retrograde'}
          disabled={!flying}
          onSelect={() => onSelect('retrograde')}
        />
      </div>
      <div style={{ paddingRight: '1.2em', ...rowStyle }}>
        <CircleIcon
          glyph={HOLD_MODE_ICONS.normal!}
          color={HOLD_MODE_COLORS.normal!}
          title={MODE_TITLES.normal}
          active={active === 'normal'}
          disabled={!flying}
          onSelect={() => onSelect('normal')}
        />
        <CircleIcon
          glyph={HOLD_MODE_ICONS.antinormal!}
          color={HOLD_MODE_COLORS.antinormal!}
          title={MODE_TITLES.antinormal}
          active={active === 'antinormal'}
          disabled={!flying}
          onSelect={() => onSelect('antinormal')}
        />
      </div>
      <div style={{ paddingRight: '.8em', ...rowStyle }}>
        <CircleIcon
          glyph={HOLD_MODE_ICONS['radial-out']!}
          color={HOLD_MODE_COLORS['radial-out']!}
          title={MODE_TITLES['radial-out']}
          active={active === 'radial-out'}
          disabled={!flying}
          onSelect={() => onSelect('radial-out')}
        />
        <CircleIcon
          glyph={HOLD_MODE_ICONS['radial-in']!}
          color={HOLD_MODE_COLORS['radial-in']!}
          title={MODE_TITLES['radial-in']}
          active={active === 'radial-in'}
          disabled={!flying}
          onSelect={() => onSelect('radial-in')}
        />
      </div>
      <div style={rowStyle}>
        <CircleIcon
          glyph={HOLD_MODE_ICONS.maneuver!}
          color={HOLD_MODE_COLORS.maneuver!}
          title={MODE_TITLES.maneuver}
          active={active === 'maneuver'}
          disabled={!flying || !hasNode}
          onSelect={() => onSelect('maneuver')}
        />
      </div>
    </div>
  );
}

/** Vehicle-status indicators stacked beside the navball (orbit profile +
 * vehicle state). Non-interactive badges, tucked toward the navball and sunk
 * to the lower-right near the bottom arc. */
export function StatusColumn({
  orbit,
  surfaceState,
}: {
  orbit?: OrbitSummary;
  surfaceState: SurfaceState;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        pointerEvents: 'auto',
      }}
    >
      {orbit && (
        <CircleIcon
          glyph={ORBIT_ICONS[orbit.kind]}
          color={ORBIT_COLORS[orbit.kind]}
          title={ORBIT_LABELS[orbit.kind]}
          diameter={STATUS_DIAMETER}
          glyphSize={STATUS_GLYPH_SIZE}
          // An impact trajectory is only meaningful in flight.
          disabled={surfaceState !== 'flying' && orbit.kind === 'impacting'}
        />
      )}
      <CircleIcon
        glyph={STATE_ICONS[surfaceState]}
        color={STATE_COLORS[surfaceState]}
        title={STATE_LABELS[surfaceState]}
        diameter={STATUS_DIAMETER}
        glyphSize={STATUS_GLYPH_SIZE}
      />
    </div>
  );
}

interface NavballInstrumentProps extends NavballProps {
  throttle: number;
  forceRatio: number;
  atmosphereRatio: number;
  surfaceState: SurfaceState;
  autopilotMode: AutopilotMode;
  orbit?: OrbitSummary;
  /** Values shown on the bottom shelf (ALT/VEL), mirroring AP/PE on top. */
  bottomRows?: FlightTelemetryRow[];
}

/** Full names for the bottom-shelf abbreviations (hover tooltips). */
const BOTTOM_SHELF_TITLES: Record<string, string> = {
  ALT: 'Altitude',
  VEL: 'Velocity',
  VERT: 'Vertical speed',
};

interface ProximityProps {
  rows: FlightTelemetryRow[];
}

interface AttitudeProps {
  rows: FlightTelemetryRow[];
}

type SurfaceState = 'flying' | 'landed' | 'crashed';

const RADIUS = 85;
const VISIBLE_RADIUS = 83.5;
const SIZE = 170;
const CENTER = SIZE / 2;

export function Navball({
  orientation,
  relativePosition,
  relativeVelocity,
  parentRotationAxis,
  maneuverDirection,
  orbitNormal,
}: NavballProps) {
  const state = computeNavballState({
    orientation,
    relativePosition,
    relativeVelocity,
    parentRotationAxis,
    radius: RADIUS,
    maneuverDirection,
    orbitNormal,
  });
  const toPath = (segment: { x: number; y: number }[]) =>
    segment.map((point, index) => `${index === 0 ? 'M' : 'L'} ${CENTER + point.x} ${CENTER + point.y}`).join(' ');
  const horizonPaths = visibleNavballSegments(state.horizon)
    .filter((segment) => segment.length > 1)
    .map(toPath);
  const meridianPaths = state.meridians.flatMap((meridian) =>
    visibleNavballSegments(meridian)
      .filter((segment) => segment.length > 1)
      .map(toPath),
  );
  const skyPath = state.sky.length > 1 ? `${toPath(state.sky)} Z` : null;

  return (
    <div
      style={{
        width: SIZE,
        height: SIZE,
        pointerEvents: 'none',
      }}
    >
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role='img'
        aria-label='Orbital navball'
      >
        <defs>
          <clipPath id='navball-clip'>
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS}
            />
          </clipPath>
          <radialGradient
            id='navball-shade'
            cx='35%'
            cy='25%'
            r='70%'
          >
            <stop
              offset='0%'
              stopColor='#34476b'
            />
            <stop
              offset='55%'
              stopColor='#17233e'
            />
            <stop
              offset='100%'
              stopColor='#050912'
            />
          </radialGradient>
        </defs>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={VISIBLE_RADIUS}
          fill='url(#navball-shade)'
          stroke='#d9e3ff'
          strokeWidth='2'
        />
        <g clipPath='url(#navball-clip)'>
          {/* Attitude-indicator shading: brown ground base, blue sky hemisphere
              following the curved horizon (toward radial-out). */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill='rgba(120,80,46,0.5)'
          />
          {skyPath && (
            <path
              d={skyPath}
              fill='rgba(60,116,170,0.5)'
            />
          )}
          {horizonPaths.map((path, index) => (
            <path
              key={index}
              d={path}
              fill='none'
              stroke='#f3f0d0'
              strokeWidth='2'
              strokeDasharray='6 5'
              opacity='0.8'
            />
          ))}
          {meridianPaths.map((path, index) => (
            <path
              key={`meridian-${index}`}
              d={path}
              fill='none'
              stroke='rgba(217,227,255,0.18)'
              strokeWidth='1'
            />
          ))}
          {state.compass &&
            Object.entries(state.compass).map(([key, point]) => {
              if (!point.visible) return null;
              const label = key[0].toUpperCase();
              const length = 8;
              const magnitude = Math.hypot(point.x, point.y) || 1;
              const ux = point.x / magnitude;
              const uy = point.y / magnitude;

              return (
                <g
                  key={key}
                  opacity='0.72'
                >
                  <line
                    x1={CENTER + point.x - ux * length}
                    y1={CENTER + point.y - uy * length}
                    x2={CENTER + point.x}
                    y2={CENTER + point.y}
                    stroke='rgba(220,235,255,0.65)'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                  />
                  <text
                    x={CENTER + point.x - ux * (length + 7)}
                    y={CENTER + point.y - uy * (length + 7) + 3}
                    textAnchor='middle'
                    fontFamily='monospace'
                    fontSize='7'
                    fill='rgba(220,235,255,0.72)'
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          {Object.entries(state.markers).map(([key, point]) => {
            if (!shouldRenderNavballMarker(point)) return null;
            const Glyph = MARKER_ICONS[key];
            if (!Glyph) return null;
            const color = MARKER_COLORS[key] ?? '#d9e3ff';
            return (
              <g
                key={key}
                transform={`translate(${CENTER + point.x} ${CENTER + point.y}) scale(0.85)`}
                style={{ pointerEvents: 'auto' }}
                {...(MARKER_LABELS[key] ? hoverTooltip(MARKER_LABELS[key]) : {})}
              >
                {MARKER_LABELS[key] && <title>{MARKER_LABELS[key]}</title>}
                <circle
                  r={11}
                  fill='rgba(0,0,0,0.55)'
                />
                <Glyph color={color} />
              </g>
            );
          })}
        </g>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={VISIBLE_RADIUS}
          fill='none'
          stroke='rgba(255,255,255,0.35)'
          strokeWidth='1'
        />
        <g
          stroke='#ffffff'
          strokeWidth='2'
          strokeLinecap='round'
        >
          <line
            x1={CENTER - 14}
            y1={CENTER}
            x2={CENTER - 4}
            y2={CENTER}
          />
          <line
            x1={CENTER + 4}
            y1={CENTER}
            x2={CENTER + 14}
            y2={CENTER}
          />
          <line
            x1={CENTER}
            y1={CENTER - 14}
            x2={CENTER}
            y2={CENTER - 4}
          />
          <line
            x1={CENTER}
            y1={CENTER + 4}
            x2={CENTER}
            y2={CENTER + 14}
          />
        </g>
      </svg>
    </div>
  );
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
  atmosphereRatio,
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
        bottom: 14, // bottom shelf overhangs ~2px below the instrument → ~12px viewport gap
        transform: 'translateX(-50%)',
        pointerEvents: 'none',
        zIndex: 10, // keep the cluster (and its hover targets) above the 3D canvas
      }}
    >
      {/* The instrument is the only in-flow child, so translateX(-50%) above
          centers the navball itself on the page. The side columns are anchored
          to this box absolutely, so their widths never shift the navball. */}
      <div style={{ position: 'relative', width: 190 }}>
        {onSelectMode && (
          <div
            style={{
              position: 'absolute',
              right: '100%',
              top: '50%',
              transform: 'translateY(-50%)',
              marginRight: -13, // tuck the buttons over the navball's left arc
            }}
          >
            <AutopilotColumn
              active={autopilotMode}
              hasNode={!!hasManeuverNode}
              flying={surfaceState === 'flying'}
              onSelect={onSelectMode}
            />
          </div>
        )}
        <NavballInstrument
          orientation={orientation}
          relativePosition={relativePosition}
          relativeVelocity={relativeVelocity}
          parentRotationAxis={parentRotationAxis}
          mode={mode}
          throttle={throttle}
          forceRatio={forceRatio}
          atmosphereRatio={atmosphereRatio}
          surfaceState={surfaceState}
          autopilotMode={autopilotMode}
          maneuverDirection={maneuverDirection}
          orbitNormal={orbitNormal}
          orbit={orbit}
          bottomRows={rows.slice(0, 2)}
        />
        <div style={{ position: 'absolute', left: '100%', bottom: 10, marginLeft: -8 }}>
          <StatusColumn orbit={orbit} surfaceState={surfaceState} />
        </div>
      </div>
    </div>
  );
}

export function NavballInstrument(props: NavballInstrumentProps) {
  const { throttle, forceRatio, atmosphereRatio, orbit, bottomRows = [] } = props;
  const throttleArc = computeArcProgressPath({
    value: throttle,
    radius: 90,
    cx: 95,
    cy: 90,
    startDegrees: 135,
    endDegrees: 45,
  });
  // Left side splits into two thin concentric arcs that touch: g-load (outer,
  // radius 90 to match the throttle arc) and ambient atmospheric density (inner,
  // radius 87 — 3 apart so the 3-wide strokes meet). Both mirror the throttle.
  const forceArc = computeArcProgressPath({
    value: forceRatio,
    radius: 90,
    cx: 95,
    cy: 90,
    startDegrees: 135,
    endDegrees: 45,
    mirror: true,
  });
  const atmosphereArc = computeArcProgressPath({
    value: atmosphereRatio,
    radius: 87,
    cx: 95,
    cy: 90,
    startDegrees: 135,
    endDegrees: 45,
    mirror: true,
  });
  return (
    <div
      style={{
        position: 'relative',
        width: 190,
        height: 180, // navball (170, at top:5) centered → 5px margins, symmetric shelves
        fontFamily: 'monospace',
        pointerEvents: 'none',
      }}
    >
      <svg
        width='190'
        height='180'
        viewBox='0 0 190 180'
        aria-hidden='true'
        style={{ position: 'absolute', left: 0, top: 0 }}
      >
        <InstrumentArc paths={forceArc} width={3} trackColor='#2c4446' color='#ffc260' />
        <InstrumentArc paths={atmosphereArc} width={3} trackColor='#2c4a5c' color='#9cd8ff' />
        <InstrumentArc paths={throttleArc} width={6} trackColor='#406568' color='#ffc260' />
      </svg>
      <div style={{ position: 'absolute', left: 10, top: 5 }}>
        <Navball {...props} />
      </div>
      {/* Top shelf: apoapsis then periapsis. */}
      {orbit &&
        (() => {
          const ap = orbit.apoapsisAltitude === null ? '--' : formatFlightNumber(orbit.apoapsisAltitude, 'm');
          const pe = orbit.periapsisAltitude < 0 ? '--' : formatFlightNumber(orbit.periapsisAltitude, 'm');
          return (
            <Shelf top={-2}>
              <ShelfValue
                label='AP'
                value={ap}
                title={`Apoapsis: ${ap}`}
              />
              <ShelfValue
                label='PE'
                value={pe}
                title={`Periapsis: ${pe}`}
              />
            </Shelf>
          );
        })()}
      {/* Bottom shelf: altitude then speed, overlapping the navball's bottom
          edge symmetrically with the AP/PE shelf on top (which uses top:-2). */}
      {bottomRows.length > 0 && (
        <Shelf bottom={-2}>
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
  );
}

/** Render a navball glyph as a standalone HTML icon, with a hover tooltip. */
function GlyphIcon({
  glyph: Glyph,
  size,
  color,
  title,
}: {
  glyph: NavGlyph;
  size: number;
  color: string;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox='-12 -12 24 24'
      aria-label={title}
      focusable={false}
      {...(title ? hoverTooltip(title) : {})}
    >
      {title && <title>{title}</title>}
      <Glyph color={color} />
    </svg>
  );
}

/** A small panel that slightly overlaps the navball's top or bottom edge.
 * Anchor by `top` (top shelf) or `bottom` (bottom shelf) so the two mirror. */
function Shelf({ top, bottom, children }: { top?: number; bottom?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top,
        bottom,
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
  );
}

function ShelfValue({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <span
      {...(title ? hoverTooltip(title) : {})}
      style={{ fontSize: 9, color: 'rgba(210,250,255,0.62)' }}
    >
      {label} <span style={{ color: 'rgba(255,205,112,0.94)' }}>{value}</span>
    </span>
  );
}

function InstrumentArc({
  paths,
  width,
  trackColor,
  color,
}: {
  paths: { trackPath: string; progressPath: string };
  width: number;
  trackColor: string;
  color: string;
}) {
  return (
    <g>
      <path d={paths.trackPath} fill='none' stroke={trackColor} strokeWidth={width} />
      <path d={paths.progressPath} fill='none' stroke={color} strokeWidth={width} />
    </g>
  );
}

export function Proximity({ rows }: ProximityProps) {
  return (
    <TelemetryPanel
      rows={rows}
      align='right'
    />
  );
}

export function Attitude({ rows }: AttitudeProps) {
  return (
    <TelemetryPanel
      rows={rows}
      align='left'
    />
  );
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
        <div
          key={row.label}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}
        >
          <span style={{ color: 'rgba(210,250,255,0.62)' }}>{row.label}</span>
          <span style={{ color: 'rgba(255,205,112,0.94)' }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}
