import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'

export interface WebGPUStarsProps {
  /** Radius of the star shell, in scene units. */
  radius?: number
  count?: number
  /** Point size in pixels (size attenuation is off so stars stay visible at any range). */
  size?: number
  color?: string
}

/**
 * A simple point-cloud starfield to replace drei's `<Stars>`, whose GLSL
 * `ShaderMaterial` doesn't compile under WebGPU. Points are scattered uniformly on a
 * spherical shell; `pointsMaterial` is a core material WebGPURenderer converts to a
 * node material automatically. `sizeAttenuation={false}` keeps stars a constant pixel
 * size regardless of the shell's (very large) radius.
 */
export function WebGPUStars({
  radius = 100,
  count = 3000,
  size = 1.5,
  color = '#ffffff',
}: WebGPUStarsProps) {
  const geometry = useMemo(() => {
    // Seeded PRNG (mulberry32) so the scatter is deterministic and pure — no
    // Math.random() during render, and the field is stable across re-renders.
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
  }, [radius, count])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points geometry={geometry}>
      <pointsMaterial size={size} sizeAttenuation={false} color={color} />
    </points>
  )
}
