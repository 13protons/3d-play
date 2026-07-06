import { forwardRef, useMemo } from 'react'
import { CanvasTexture, SpriteMaterial, type Sprite } from 'three'
import { markerStyleForBody } from './markerStyle'

export type OrbitalMarkerShape = 'circle' | 'triangle'

interface OrbitalMarkerProps {
  color: string
  shape: OrbitalMarkerShape
  bodyId?: string
  /**
   * HDR multiplier on the marker colour so the sprite crosses the bloom
   * threshold (2.0) and glows. Used for emissive bodies: at orbital distances
   * the Sun falls below the mesh-vs-sprite pixel threshold, and without this
   * its 40× HDR disc is replaced by a flat LDR dot that never blooms.
   */
  hdrBoost?: number
}

/** CSS color string with an alpha applied (accepts #rgb/#rrggbb inputs). */
function withAlpha(hex: string, alpha: number): string {
  const c = hex.replace('#', '')
  const full = c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function makeMarkerTexture(
  color: string,
  shape: OrbitalMarkerShape,
  bodyId?: string,
  soft = false,
): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const style = markerStyleForBody(bodyId, color)

  const ctx = canvas.getContext('2d')
  if (ctx && soft) {
    // Emissive (sun) glow sprite: a small bright core with a long, baked-in
    // radial halo. The halo must live in the TEXTURE, not come from bloom — a
    // sub-resolution HDR splat feeding the bloom threshold makes the halo
    // energy depend on subpixel phase, so the sun visibly flickers whenever it
    // drifts across the pixel grid. Baked falloff is stable by construction;
    // the HDR colour multiplier then only adds a mild bloom kicker on the
    // core (which stays saturated, so its pulsing is invisible).
    ctx.clearRect(0, 0, size, size)
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    // Core stays the body's own colour — the HDR gain saturates the very centre
    // toward white on its own, so the core's rim and the halo keep the warm
    // tint. Stops approximate a ~1/r² falloff (canvas gradients interpolate
    // linearly between stops).
    // Halo alphas are baked at roughly 1/EMISSIVE_SPRITE_HDR_GAIN so the
    // rendered halo (alpha × gain × fill) stays in LDR range and keeps the
    // body's warm tint — values much above 1 tone-map toward white. Only the
    // flat core rides at full gain (it saturates and feeds the mild bloom).
    gradient.addColorStop(0, style.fill)
    gradient.addColorStop(0.2, style.fill)
    gradient.addColorStop(0.34, withAlpha(style.fill, 0.12))
    gradient.addColorStop(0.55, withAlpha(style.fill, 0.035))
    gradient.addColorStop(0.78, withAlpha(style.fill, 0.012))
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)
  } else if (ctx) {
    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = style.fill
    ctx.strokeStyle = style.outline
    ctx.lineWidth = style.outlineWidth

    if (shape === 'circle') {
      if (style.ring) {
        ctx.save()
        ctx.translate(size / 2, size / 2)
        ctx.rotate(-0.35)
        ctx.strokeStyle = style.ringColor ?? style.fill
        ctx.lineWidth = 4
        ctx.beginPath()
        ctx.ellipse(0, 0, size * 0.42, size * 0.14, 0, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(size / 2, size * 0.16)
      ctx.lineTo(size * 0.82, size * 0.78)
      ctx.lineTo(size * 0.18, size * 0.78)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }

  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export const OrbitalMarker = forwardRef<Sprite, OrbitalMarkerProps>(
  function OrbitalMarker({ color, shape, bodyId, hdrBoost }, ref) {
    const material = useMemo(() => {
      const texture = makeMarkerTexture(color, shape, bodyId, hdrBoost !== undefined)
      const material = new SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      })
      // Raw component multiplier (not a colour-space conversion) — the canvas
      // texture carries the tint, this pushes it into HDR for bloom.
      if (hdrBoost !== undefined) material.color.setScalar(hdrBoost)
      return material
    }, [color, shape, bodyId, hdrBoost])

    return <sprite ref={ref} material={material} />
  },
)
