// Build the real starfield asset from the vendored BSC5P-JSON-XYZ catalog.
//
// Source: https://github.com/frostoven/BSC5P-JSON-XYZ (CC BY 4.0; see source/LICENSE).
// We join two of its files on the BSC5P line ID `i`:
//   - bsc5p_radec_min.json      → right ascension `r` / declination `d` (radians), blackbody colour `K`
//   - bsc5p_spectral_extra_min.json → apparent (visual) magnitude `b`
//
// and emit a compact little-endian binary (structure-of-arrays) the renderer mmaps into
// typed-array views. The catalogue is EQUATORIAL (RA/Dec); we rotate each star into the
// ECLIPTIC frame here (obliquity ε is a physical constant, safe to bake) and store unit
// directions. At load the renderer applies the sim's own ecliptic→app-Y-up mapping
// (jplEclipticToAppYUpVector) so the stars share the exact frame as the planets — the
// ecliptic/zodiac runs along the sun's path and the galactic plane tilts correctly.
//
// Magnitude drives the existing limiting-magnitude fade (see src/render/sky/sunHorizon.ts) and
// colour tints each star.
//
// Stars fainter than MAG_LIMIT are dropped: the naked eye can't see them at night, and the
// renderer's limiting magnitude already fades them to black, so shipping them is pure waste.
//
// Re-run with `npm run build:stars` after updating the vendored source.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = join(HERE, 'source')
const OUT_DIR = join(HERE, '..', '..', 'public', 'data', 'stars')

const MAG_LIMIT = 6.5 // NAKED_EYE_LIMIT — fainter stars are invisible at night, so we drop them.
const OBLIQUITY = 23.439281 * (Math.PI / 180) // J2000 mean obliquity of the ecliptic.
const FORMAT_VERSION = 3

const radec = JSON.parse(readFileSync(join(SOURCE, 'bsc5p_radec_min.json'), 'utf8'))
const spectral = JSON.parse(readFileSync(join(SOURCE, 'bsc5p_spectral_extra_min.json'), 'utf8'))

const magById = new Map(spectral.map((s) => [s.i, s.b]))

const cosE = Math.cos(OBLIQUITY)
const sinE = Math.sin(OBLIQUITY)

const stars = []
let droppedFaint = 0
let droppedNoData = 0
for (const r of radec) {
  const b = magById.get(r.i)
  // Skip non-stars (clusters/galaxies carry no blackbody colour) and anything without a magnitude.
  if (!r.K || typeof b !== 'number') {
    droppedNoData++
    continue
  }
  if (b > MAG_LIMIT) {
    droppedFaint++
    continue
  }
  // Equatorial unit vector (X→vernal equinox, Z→north celestial pole).
  const cosDec = Math.cos(r.d)
  const xe = cosDec * Math.cos(r.r)
  const ye = cosDec * Math.sin(r.r)
  const ze = Math.sin(r.d)
  // Equatorial → ecliptic: rotate about the shared X axis by -ε.
  const x = xe
  const y = ye * cosE + ze * sinE
  const z = -ye * sinE + ze * cosE
  stars.push({
    x,
    y,
    z,
    mag: b,
    cr: Math.round(Math.max(0, Math.min(1, r.K.r)) * 255),
    cg: Math.round(Math.max(0, Math.min(1, r.K.g)) * 255),
    cb: Math.round(Math.max(0, Math.min(1, r.K.b)) * 255),
  })
}

const count = stars.length

// Structure-of-arrays binary, all little-endian, sections in this order:
//   [0]                   uint32  formatVersion
//   [4]                   uint32  count
//   [8]                   float32 directions[count*3]  (ecliptic-frame unit vectors)
//   [8 + 12c]             float32 magnitudes[count]
//   [8 + 16c]             uint8   colors[count*3]       (0–255 RGB)
const headerBytes = 8
const dirBytes = count * 3 * 4
const magBytes = count * 4
const colorBytes = count * 3
const buffer = new ArrayBuffer(headerBytes + dirBytes + magBytes + colorBytes)

const header = new DataView(buffer)
header.setUint32(0, FORMAT_VERSION, true)
header.setUint32(4, count, true)

const dirs = new Float32Array(buffer, headerBytes, count * 3)
const mags = new Float32Array(buffer, headerBytes + dirBytes, count)
const colors = new Uint8Array(buffer, headerBytes + dirBytes + magBytes, count * 3)

for (let i = 0; i < count; i++) {
  const s = stars[i]
  dirs[i * 3] = s.x
  dirs[i * 3 + 1] = s.y
  dirs[i * 3 + 2] = s.z
  mags[i] = s.mag
  colors[i * 3] = s.cr
  colors[i * 3 + 1] = s.cg
  colors[i * 3 + 2] = s.cb
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'bsc5p.bin'), Buffer.from(buffer))
writeFileSync(
  join(OUT_DIR, 'bsc5p.json'),
  JSON.stringify(
    {
      source: 'BSC5P-JSON-XYZ (https://github.com/frostoven/BSC5P-JSON-XYZ, CC BY 4.0)',
      formatVersion: FORMAT_VERSION,
      count,
      magLimit: MAG_LIMIT,
      frame: 'ecliptic (J2000); apply jplEclipticToAppYUpVector at load for the app frame',
      bytes: buffer.byteLength,
      layout: 'uint32 version, uint32 count, float32 dir[count*3], float32 mag[count], uint8 color[count*3]',
    },
    null,
    2,
  ) + '\n',
)

const kb = (n) => (n / 1024).toFixed(1)
console.log(`stars kept: ${count} (≤ mag ${MAG_LIMIT})`)
console.log(`dropped: ${droppedFaint} faint, ${droppedNoData} non-star/no-magnitude`)
console.log(`bsc5p.bin: ${kb(buffer.byteLength)} KB`)
