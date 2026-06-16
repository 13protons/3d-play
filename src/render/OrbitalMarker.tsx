import { forwardRef, useMemo } from 'react'
import { CanvasTexture, SpriteMaterial, type Sprite } from 'three'
import { markerStyleForBody } from './markerStyle'

export type OrbitalMarkerShape = 'circle' | 'triangle'

interface OrbitalMarkerProps {
  color: string
  shape: OrbitalMarkerShape
  bodyId?: string
}

function makeMarkerTexture(
  color: string,
  shape: OrbitalMarkerShape,
  bodyId?: string,
): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const style = markerStyleForBody(bodyId, color)

  const ctx = canvas.getContext('2d')
  if (ctx) {
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
  function OrbitalMarker({ color, shape, bodyId }, ref) {
    const material = useMemo(() => {
      const texture = makeMarkerTexture(color, shape, bodyId)
      return new SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      })
    }, [color, shape, bodyId])

    return <sprite ref={ref} material={material} />
  },
)
