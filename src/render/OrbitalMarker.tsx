import { forwardRef, useMemo } from 'react'
import { CanvasTexture, SpriteMaterial, type Sprite } from 'three'

export type OrbitalMarkerShape = 'circle' | 'triangle'

interface MarkerStyle {
  fill: string
  outline: string
  outlineWidth: number
  ring: boolean
  ringColor?: string
}

interface OrbitalMarkerProps {
  color: string
  shape: OrbitalMarkerShape
  bodyId?: string
}

export function markerStyleForBody(bodyId: string | undefined, color: string): MarkerStyle {
  const baseStyle = {
    fill: color,
    outline: color,
    outlineWidth: 2,
    ring: false,
  }

  switch (bodyId) {
    case 'venus':
      return { ...baseStyle, fill: '#f4c85a', outline: '#8f6f22' }
    case 'mars':
      return { ...baseStyle, fill: '#d75a32', outline: '#78311c' }
    case 'jupiter':
      return { ...baseStyle, fill: '#d98b45', outline: '#74401d' }
    case 'saturn':
      return {
        ...baseStyle,
        fill: '#d6b36a',
        outline: '#766033',
        ring: true,
        ringColor: 'rgba(232,211,160,0.95)',
      }
    default:
      return baseStyle
  }
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
