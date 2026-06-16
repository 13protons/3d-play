import { forwardRef, useMemo } from 'react'
import { type ThreeEvent } from '@react-three/fiber'
import { CanvasTexture, SpriteMaterial, type Sprite } from 'three'

export type WaypointKind = 'apoapsis' | 'periapsis' | 'ascendingNode' | 'descendingNode'

const STYLES: Record<WaypointKind, { label: string; fill: string; outline: string }> = {
  apoapsis: { label: 'AP', fill: 'rgba(120,200,255,0.85)', outline: '#22466a' },
  periapsis: { label: 'PE', fill: 'rgba(255,120,90,0.85)', outline: '#6a2a1a' },
  ascendingNode: { label: 'AN', fill: 'rgba(110,255,150,0.85)', outline: '#1c5a30' },
  descendingNode: { label: 'DN', fill: 'rgba(255,140,200,0.85)', outline: '#6a2348' },
}

function makeWaypointTexture(kind: WaypointKind): CanvasTexture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const style = STYLES[kind]
    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = style.fill
    ctx.strokeStyle = style.outline
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#000'
    ctx.font = `bold ${Math.floor(size * 0.42)}px monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(style.label, size / 2, size / 2 + 1)
  }
  const texture = new CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

interface WaypointMarkerProps {
  kind: WaypointKind
  position: [number, number, number]
  onClick?: (event: ThreeEvent<MouseEvent>) => void
}

export const WaypointMarker = forwardRef<Sprite, WaypointMarkerProps>(
  function WaypointMarker({ kind, position, onClick }, ref) {
    const material = useMemo(() => {
      const texture = makeWaypointTexture(kind)
      return new SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      })
    }, [kind])

    return <sprite ref={ref} material={material} position={position} onClick={onClick} />
  },
)
