import { jplEclipticToAppYUpVector } from '../../sim/ephemeris'

/**
 * Loads the real star catalogue baked by scripts/star-catalog/buildStarCatalog.mjs from the
 * BSC5P-JSON-XYZ data (8.4k naked-eye stars, ≤ mag 6.5). The asset is a compact little-endian
 * structure-of-arrays binary (see that script for the exact layout) we read straight into typed
 * arrays — no per-star JSON parsing.
 *
 * Directions are stored as ECLIPTIC-frame unit vectors. We apply the sim's own
 * jplEclipticToAppYUpVector here so the stars land in the exact same frame as the planets and
 * sun (the zodiac follows the sun's path; the galactic plane tilts correctly), then scale onto
 * whatever shell radius the caller wants. Each star also carries its real apparent `magnitude`
 * (drives the limiting-magnitude fade in MagnitudeStars), blackbody `color`, and a twinkle
 * `phase` (de-syncs the per-star scintillation in the vehicle view).
 */

export interface StarCatalog {
  count: number
  /** Ecliptic-frame unit direction vectors, count*3. */
  directions: Float32Array
  /** Apparent (visual) magnitude per star. */
  magnitudes: Float32Array
  /** RGB 0–255 per star, count*3. */
  colors: Uint8Array
  /** Per-star twinkle phase 0–1. */
  phases: Float32Array
}

const ASSET_URL = `${import.meta.env.BASE_URL}data/stars/bsc5p.bin`
const HEADER_BYTES = 8

let cached: Promise<StarCatalog> | undefined

/** Fetch + decode the catalogue once; subsequent callers share the same promise. */
export function loadStarCatalog(): Promise<StarCatalog> {
  if (!cached) {
    cached = fetch(ASSET_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`star catalogue ${res.status} at ${ASSET_URL}`)
        return res.arrayBuffer()
      })
      .then((buffer) => {
        const header = new DataView(buffer)
        const count = header.getUint32(4, true)
        const dirBytes = count * 3 * 4
        const magBytes = count * 4
        const colorBytes = count * 3
        return {
          count,
          directions: new Float32Array(buffer, HEADER_BYTES, count * 3),
          magnitudes: new Float32Array(buffer, HEADER_BYTES + dirBytes, count),
          colors: new Uint8Array(buffer, HEADER_BYTES + dirBytes + magBytes, count * 3),
          phases: new Float32Array(buffer, HEADER_BYTES + dirBytes + magBytes + colorBytes, count),
        }
      })
  }
  return cached
}

/** Per-instance arrays for the instanced-Sprite starfield (WebGPU caps THREE.Points at 1px, so
 *  sized stars must be drawn as instanced sprite quads — see MagnitudeStars). */
export interface StarInstanceData {
  count: number
  /** App-frame positions on the shell, count*3. */
  positions: Float32Array
  /** Apparent magnitude, count. */
  magnitudes: Float32Array
  /** RGB 0–1, count*3. */
  colors: Float32Array
  /** Twinkle phase 0–1, count. */
  phases: Float32Array
}

/** Project the catalogue's ecliptic unit directions into the app frame and onto `radius`, and
 *  expand the colours to floats — ready to feed instanced buffer attributes. */
export function buildStarInstanceData(catalog: StarCatalog, radius: number): StarInstanceData {
  const { count, directions, magnitudes, colors, phases } = catalog
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const [ax, ay, az] = jplEclipticToAppYUpVector([
      directions[i * 3],
      directions[i * 3 + 1],
      directions[i * 3 + 2],
    ])
    positions[i * 3] = ax * radius
    positions[i * 3 + 1] = ay * radius
    positions[i * 3 + 2] = az * radius
  }

  const colorFloats = new Float32Array(count * 3)
  for (let i = 0; i < count * 3; i++) colorFloats[i] = colors[i] / 255

  return { count, positions, magnitudes: magnitudes.slice(), colors: colorFloats, phases: phases.slice() }
}
