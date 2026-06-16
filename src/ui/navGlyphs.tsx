import type { ReactElement } from 'react'

/**
 * Navball icon art. Each glyph is origin-centered SVG content in a 24-unit box
 * (viewBox "-12 -12 24 24"), so the same glyph renders both as an on-ball
 * marker (inside the navball <svg> via a <g transform>) and as a mode button.
 * KSP-flavored; this is the file to edit to restyle the iconography. The
 * registry that maps modes/markers to these glyphs lives in navIcons.ts.
 */
export type NavGlyph = (props: { color: string }) => ReactElement

const stroke = (color: string, width = 1.6) => ({
  fill: 'none' as const,
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const Prograde: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <circle cx={0} cy={0} r={5} />
    <circle cx={0} cy={0} r={1.4} fill={color} stroke="none" />
    <line x1={0} y1={-5} x2={0} y2={-9} />
    <line x1={-4.3} y1={2.5} x2={-7.8} y2={4.6} />
    <line x1={4.3} y1={2.5} x2={7.8} y2={4.6} />
  </g>
)

export const Retrograde: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <circle cx={0} cy={0} r={5} />
    <line x1={-2.6} y1={-2.6} x2={2.6} y2={2.6} />
    <line x1={2.6} y1={-2.6} x2={-2.6} y2={2.6} />
    <line x1={0} y1={-5} x2={0} y2={-9} />
    <line x1={-4.3} y1={2.5} x2={-7.8} y2={4.6} />
    <line x1={4.3} y1={2.5} x2={7.8} y2={4.6} />
  </g>
)

// Triangles are bounding-box-centered on the origin (y symmetric about 0) so the
// marker point sits in the middle of the glyph, like the circle-based icons.
export const Normal: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <path d="M 0 -6.75 L 7.4 6.75 L -7.4 6.75 Z" />
  </g>
)

export const Antinormal: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <path d="M 0 6.75 L 7.4 -6.75 L -7.4 -6.75 Z" />
  </g>
)

export const RadialOut: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <circle cx={0} cy={0} r={4.6} />
    <path d="M -4.2 -5.8 L 0 -10 L 4.2 -5.8" />
  </g>
)

export const RadialIn: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <circle cx={0} cy={0} r={4.6} />
    <path d="M -4.2 -10 L 0 -5.8 L 4.2 -10" />
  </g>
)

export const Hold: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <circle cx={0} cy={0} r={8} />
    <circle cx={0} cy={0} r={2.2} fill={color} stroke="none" />
  </g>
)

export const Maneuver: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <circle cx={0} cy={0} r={5} />
    <path d="M 0 -9.5 L 3.8 -4.6 L -3.8 -4.6 Z" fill={color} stroke="none" />
  </g>
)

// --- Vehicle-state glyphs ------------------------------------------------

/** Airborne: an ascending craft above the ground gap. */
export const Flying: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <path d="M -6 2 L 0 -7 L 6 2" />
    <line x1={-7} y1={8} x2={7} y2={8} strokeDasharray="2 2" />
  </g>
)

/** Landed: a craft resting on the surface line. */
export const Landed: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <line x1={-8} y1={7} x2={8} y2={7} />
    <path d="M -5 7 L 0 -3 L 5 7" />
  </g>
)

/** Crashed: a burst. */
export const Crashed: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <line x1={-8} y1={0} x2={8} y2={0} />
    <line x1={0} y1={-8} x2={0} y2={8} />
    <line x1={-5.5} y1={-5.5} x2={5.5} y2={5.5} />
    <line x1={5.5} y1={-5.5} x2={-5.5} y2={5.5} />
  </g>
)

// --- Orbital-closure glyphs ----------------------------------------------

/** Closed orbit: an ellipse around the body. */
export const OrbitClosed: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <ellipse cx={0} cy={0} rx={9} ry={5.5} />
    <circle cx={0} cy={0} r={1.6} fill={color} stroke="none" />
  </g>
)

/** Impact: a trajectory dropping into the ground. */
export const Impact: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <line x1={-9} y1={7} x2={9} y2={7} />
    <line x1={0} y1={-8} x2={0} y2={4} />
    <path d="M -3.5 0.5 L 0 4.5 L 3.5 0.5" />
  </g>
)

/** Escape: an open (hyperbolic) trajectory. */
export const Escape: NavGlyph = ({ color }) => (
  <g {...stroke(color)}>
    <path d="M -8 7 Q 0 -11 8 7" />
    <circle cx={0} cy={4} r={1.6} fill={color} stroke="none" />
  </g>
)
