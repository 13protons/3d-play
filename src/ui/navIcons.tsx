import type { AutopilotMode } from '../sim/autopilot'
import type { OrbitKind } from '../sim/vehicle/referenceFrame'
import {
  Antinormal,
  Crashed,
  Escape,
  Flying,
  Hold,
  Impact,
  Landed,
  Maneuver,
  Normal,
  OrbitClosed,
  Prograde,
  RadialIn,
  RadialOut,
  Retrograde,
  type NavGlyph,
} from './navGlyphs'

export type SurfaceState = 'flying' | 'landed' | 'crashed'

/**
 * Maps autopilot modes and navball markers to their glyphs + accent colors.
 * The glyph art lives in navGlyphs.tsx; this is the single place that wires
 * modes/markers to a glyph and a color, shared by the mode buttons and the
 * on-ball markers so a button always matches the marker it drives.
 */

export type { NavGlyph }

/** Autopilot mode → glyph. 'off' has no icon. */
export const HOLD_MODE_ICONS: Partial<Record<AutopilotMode, NavGlyph>> = {
  damp: Hold,
  prograde: Prograde,
  retrograde: Retrograde,
  normal: Normal,
  antinormal: Antinormal,
  'radial-out': RadialOut,
  'radial-in': RadialIn,
  maneuver: Maneuver,
}

/** Navball marker key → glyph (keys match navballMath's marker set). */
export const MARKER_ICONS: Record<string, NavGlyph> = {
  prograde: Prograde,
  retrograde: Retrograde,
  normal: Normal,
  antiNormal: Antinormal,
  radialOut: RadialOut,
  radialIn: RadialIn,
  maneuver: Maneuver,
}

/** Per-mode accent colors, shared by the mode buttons and the on-ball markers. */
export const HOLD_MODE_COLORS: Partial<Record<AutopilotMode, string>> = {
  damp: '#cfe0ff',
  prograde: '#9cff8f',
  retrograde: '#ff9a8f',
  normal: '#d4a4ff',
  antinormal: '#b8b8ff',
  'radial-out': '#8fd8ff',
  'radial-in': '#ffcf70',
  maneuver: '#ffcc00',
}

/** Vehicle state → glyph + color (bottom shelf). */
export const STATE_ICONS: Record<SurfaceState, NavGlyph> = {
  flying: Flying,
  landed: Landed,
  crashed: Crashed,
}
export const STATE_COLORS: Record<SurfaceState, string> = {
  flying: '#9cd8ff',
  landed: '#9cff8f',
  crashed: '#ff7a6a',
}
export const STATE_LABELS: Record<SurfaceState, string> = {
  flying: 'Flying',
  landed: 'Landed',
  crashed: 'Crashed',
}

/** Orbital closure → glyph + color (top shelf). */
export const ORBIT_ICONS: Record<OrbitKind, NavGlyph> = {
  closed: OrbitClosed,
  impacting: Impact,
  open: Escape,
}
export const ORBIT_COLORS: Record<OrbitKind, string> = {
  closed: '#9cff8f',
  impacting: '#ff7a6a',
  open: '#ffcf70',
}
export const ORBIT_LABELS: Record<OrbitKind, string> = {
  closed: 'Closed orbit',
  impacting: 'Impact trajectory',
  open: 'Escape trajectory',
}

/** Marker-key → hover label (keys match navballMath's marker set). */
export const MARKER_LABELS: Record<string, string> = {
  prograde: 'Prograde',
  retrograde: 'Retrograde',
  normal: 'Normal',
  antiNormal: 'Anti-normal',
  radialOut: 'Radial out',
  radialIn: 'Radial in',
  maneuver: 'Maneuver',
}

/** Marker-key → color (keys match navballMath's marker set). */
export const MARKER_COLORS: Record<string, string> = {
  prograde: '#9cff8f',
  retrograde: '#ff9a8f',
  normal: '#d4a4ff',
  antiNormal: '#b8b8ff',
  radialOut: '#8fd8ff',
  radialIn: '#ffcf70',
  maneuver: '#ffcc00',
}
