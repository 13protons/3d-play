import { useThree, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { useModeStore } from '../state/mode'
import { drainRenderCounts } from './perfCounters'

/**
 * Logs one performance sample per second to the console while its view is
 * active, as a single JSON object (JSONL) tagged "perf" so it's easy to
 * filter and to paste into a parser. Each line reports frame rate, the worst
 * frame time in the window (hitch detector), the renderer's draw-call /
 * triangle load, and React renders/sec per instrumented component (the P2
 * per-tick re-render signal). Mounted once per scene (orbital + vehicle).
 */
export function PerfLogger({ view }: { view: 'orbital' | 'vehicle' }) {
  const gl = useThree((s) => s.gl)
  const activeView = useModeStore((s) => s.activeView)
  const start = useRef(0)
  const frames = useRef(0)
  const frameMsMax = useRef(0)
  const windowStart = useRef(0)

  useFrame((_, delta) => {
    if (activeView !== view) return
    const now = performance.now()
    if (windowStart.current === 0) {
      start.current = now
      windowStart.current = now
      return
    }
    frames.current += 1
    frameMsMax.current = Math.max(frameMsMax.current, delta * 1000)

    const windowMs = now - windowStart.current
    if (windowMs < 1000) return

    const info = gl.info
    const drained = drainRenderCounts()
    const renders: Record<string, number> = {}
    for (const key of Object.keys(drained)) {
      renders[key] = Math.round((drained[key] * 1000) / windowMs)
    }

    console.log(JSON.stringify({
      tag: 'perf',
      view,
      t: Math.round((now - start.current) / 100) / 10,
      fps: Math.round((frames.current * 1000) / windowMs),
      maxMs: Math.round(frameMsMax.current * 10) / 10,
      draws: info.render.calls,
      tris: info.render.triangles,
      renders,
    }))

    frames.current = 0
    frameMsMax.current = 0
    windowStart.current = now
  })

  return null
}
