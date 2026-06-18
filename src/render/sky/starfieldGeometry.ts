import { BufferGeometry, Float32BufferAttribute } from 'three'

/**
 * A point-cloud starfield scattered uniformly on a spherical shell, with a seeded
 * PRNG (mulberry32) so the field is deterministic and pure — no Math.random() during
 * render, and stable across re-renders. Shared by the orbital starfield and the
 * vehicle sky.
 */
export function createStarfieldGeometry(radius: number, count: number): BufferGeometry {
  let seed = 0x9e3779b9 ^ count
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // Uniform direction on the unit sphere, jittered radius so it reads as a shell.
    const u = random() * 2 - 1
    const theta = random() * Math.PI * 2
    const s = Math.sqrt(1 - u * u)
    const r = radius * (0.85 + random() * 0.15)
    positions[i * 3] = r * s * Math.cos(theta)
    positions[i * 3 + 1] = r * s * Math.sin(theta)
    positions[i * 3 + 2] = r * u
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}
