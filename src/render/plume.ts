import { CanvasTexture } from 'three'

/** A vertical gradient: hot white at the nozzle → orange → transparent downstream. */
export function createPlumeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 0, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.3, 'rgba(255,180,80,0.7)')
  gradient.addColorStop(1, 'rgba(255,120,40,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 16, 64)
  return new CanvasTexture(canvas)
}
