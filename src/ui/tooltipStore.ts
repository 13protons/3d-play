import type { MouseEvent } from 'react'
import { create } from 'zustand'

interface TooltipState {
  content: string | null
  x: number
  y: number
  show: (content: string, x: number, y: number) => void
  hide: () => void
}

/**
 * Single hover-tooltip overlay for the HUD. Native `title` tooltips don't fire
 * reliably here (the navball cluster is pointer-events:none so drags reach the
 * 3D scene), so items push their label into this store on hover and a single
 * high-z-index <TooltipOverlay/> renders it at the cursor.
 */
export const useTooltipStore = create<TooltipState>((set) => ({
  content: null,
  x: 0,
  y: 0,
  show: (content, x, y) => set({ content, x, y }),
  hide: () => set({ content: null }),
}))

/** Spread onto any (pointer-events-enabled) element to show `content` on hover. */
export function hoverTooltip(content: string) {
  const track = (e: MouseEvent) => useTooltipStore.getState().show(content, e.clientX, e.clientY)
  return {
    onMouseEnter: track,
    onMouseMove: track,
    onMouseLeave: () => useTooltipStore.getState().hide(),
  }
}
