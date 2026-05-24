import { useEffect, useRef, useState, type ReactNode } from 'react'
import GUI from 'lil-gui'

interface HudPlaygroundBootstrapProps<T extends object> {
  title: string
  initialParams: T
  configure: (gui: GUI, params: T, update: () => void) => void
  children: (params: T) => ReactNode
  previewMinHeight?: number
}

export function HudPlaygroundBootstrap<T extends object>({
  title,
  initialParams,
  configure,
  children,
  previewMinHeight = 360,
}: HudPlaygroundBootstrapProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [params, setParams] = useState(() => ({ ...initialParams }))
  const paramsRef = useRef(params)

  useEffect(() => {
    const gui = new GUI({ title, autoPlace: false })
    const update = () => setParams({ ...paramsRef.current })
    configure(gui, paramsRef.current, update)
    containerRef.current?.append(gui.domElement)

    return () => gui.destroy()
  }, [configure, title])

  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 320px',
        gap: 24,
        minHeight: previewMinHeight,
        padding: '0 20px 28px',
      }}
    >
      <div
        style={{
          position: 'relative',
          minHeight: previewMinHeight,
          border: '1px solid rgba(210,225,255,0.16)',
          borderRadius: 12,
          background: 'rgba(0,0,0,0.18)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 10,
            left: 12,
            zIndex: 2,
            padding: '3px 7px',
            border: '1px solid rgba(210,225,255,0.18)',
            borderRadius: 999,
            background: 'rgba(5,8,18,0.58)',
            color: 'rgba(255,255,255,0.62)',
            fontFamily: 'monospace',
            fontSize: 10,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            pointerEvents: 'none',
          }}
        >
          {title}
        </div>
        {children(params)}
      </div>
      <aside
        style={{
          border: '1px solid rgba(210,225,255,0.16)',
          borderRadius: 12,
          background: 'rgba(5,8,18,0.72)',
          padding: 12,
        }}
      >
        <div style={{ opacity: 0.55, fontSize: 11, marginBottom: 10 }}>PARAMETERS</div>
        <div ref={containerRef} />
      </aside>
    </div>
  )
}
