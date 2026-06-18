import { useEffect, useMemo } from 'react'
import { createStarfieldGeometry } from './sky/starfieldGeometry'

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
 * `ShaderMaterial` doesn't compile under WebGPU. `pointsMaterial` is a core material
 * WebGPURenderer converts to a node material automatically. `sizeAttenuation={false}`
 * keeps stars a constant pixel size regardless of the shell's (very large) radius.
 */
export function WebGPUStars({
  radius = 100,
  count = 3000,
  size = 1.5,
  color = '#ffffff',
}: WebGPUStarsProps) {
  const geometry = useMemo(() => createStarfieldGeometry(radius, count), [radius, count])
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points geometry={geometry}>
      <pointsMaterial size={size} sizeAttenuation={false} color={color} />
    </points>
  )
}
