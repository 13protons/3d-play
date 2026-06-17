import { useTooltipStore } from './tooltipStore'

/** Single hover-tooltip overlay; renders the active tooltip near the cursor,
 * above everything else. Driven by hoverTooltip() handlers on HUD items. */
export function TooltipOverlay() {
  const content = useTooltipStore((s) => s.content)
  const x = useTooltipStore((s) => s.x)
  const y = useTooltipStore((s) => s.y)
  if (!content) return null
  return (
    <div
      style={{
        position: 'fixed',
        left: x + 14,
        top: y + 16,
        zIndex: 200,
        pointerEvents: 'none',
        background: 'rgba(8,12,22,0.95)',
        border: '1px solid rgba(210,225,255,0.3)',
        borderRadius: 6,
        padding: '3px 8px',
        color: '#dce8ff',
        fontFamily: 'monospace',
        fontSize: 11,
        whiteSpace: 'nowrap',
        boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
      }}
    >
      {content}
    </div>
  )
}
