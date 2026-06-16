import type { AutopilotMode } from '../sim/autopilot'
import {
  Antinormal,
  Hold,
  Maneuver,
  Normal,
  Prograde,
  RadialIn,
  RadialOut,
  Retrograde,
  type NavGlyph,
} from './navGlyphs'

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
