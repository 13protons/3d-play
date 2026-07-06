import { useEffect, useMemo } from 'react'
import { Color } from 'three'
import type { ColorRepresentation, Vector3 } from 'three'
import type { ThreeElements } from '@react-three/fiber'
import { Line2NodeMaterial } from 'three/webgpu'
import { Line2 } from 'three/examples/jsm/lines/webgpu/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'

export type LinePoint = Vector3 | [number, number, number] | number[]

/** Object3D-level props (events, renderOrder, visible, …) forwarded to the line. */
type PrimitiveExtras = Omit<ThreeElements['primitive'], 'object' | 'attach'>

export interface WebGPULineProps extends PrimitiveExtras {
  points: LinePoint[]
  color?: ColorRepresentation
  /** Width in pixels (screen-space); the fat-line material resolves it per frame. */
  lineWidth?: number
  opacity?: number
  /** Defaults to `opacity < 1`; pass explicitly to force a transparent material. */
  transparent?: boolean
  depthTest?: boolean
  depthWrite?: boolean
}

function toFlatPositions(points: LinePoint[]): number[] {
  const out: number[] = []
  for (const p of points) {
    if (Array.isArray(p)) out.push(p[0], p[1], p[2])
    else out.push(p.x, p.y, p.z)
  }
  return out
}

/**
 * Drop-in replacement for drei's `<Line>` on the WebGPU backend. drei's Line is
 * built on three-stdlib's GLSL `LineMaterial`, which doesn't compile under WebGPU;
 * this wraps three's WebGPU fat-line (`Line2` + node `Line2NodeMaterial`) instead.
 *
 * Supports the prop subset the app actually uses: points, color, lineWidth (pixels),
 * opacity, depthTest, depthWrite. The line is frustum-culling-exempt because the
 * geometry covers wide spans (orbit predictions, debug axes) whose screen extent the
 * default bounding sphere underestimates.
 */
export function WebGPULine({
  points,
  color = '#ffffff',
  lineWidth = 1,
  opacity = 1,
  transparent,
  depthTest = true,
  // Lines are overlay/trace geometry: depth-TESTED so planets hide them, but
  // never depth-WRITTEN — a 2px orbit line in the depth buffer reads as solid
  // geometry to depth-based post effects (the god-rays march treated traces as
  // occluders, casting screen-wide shadow bands through the sun's glow).
  depthWrite = false,
  ...rest
}: WebGPULineProps) {
  // Build geometry + material + line together as a pure function of the props,
  // mutating only locals inside the memo. Rebuilds only when a prop changes (the
  // orbit/debug callers update points on recompute, not every frame).
  const line = useMemo(() => {
    const geometry = new LineGeometry()
    geometry.setPositions(toFlatPositions(points))
    const material = new Line2NodeMaterial()
    material.color = new Color(color)
    material.linewidth = lineWidth
    material.opacity = opacity
    material.transparent = transparent ?? opacity < 1
    material.depthTest = depthTest
    material.depthWrite = depthWrite
    const line = new Line2(geometry, material)
    line.frustumCulled = false
    return line
  }, [points, color, lineWidth, opacity, transparent, depthTest, depthWrite])

  // Free the previous line's GPU resources when it's replaced or unmounted.
  useEffect(() => {
    const geometry = line.geometry
    const material = line.material
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [line])

  return <primitive object={line} {...rest} />
}
