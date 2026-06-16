import { useThree, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import { useModeStore } from '../state/mode'
import { drainRenderCounts } from './perfCounters'

/**
 * Logs one performance line per second to the console while its view is active,
 * prefixed `perf - ` so it's easy to filter/scrape. Reports frame rate, mean and
 * worst frame time over the window, and the renderer's draw-call / triangle /
 * resource counts. Mounted once per scene (orbital + vehicle).
 */
export function PerfLogger({ view }: { view: 'orbital' | 'vehicle' }) {
  const gl = useThree((s) => s.gl)
  const activeView = useModeStore((s) => s.activeView)
  const frames = useRef(0)
  const frameMsMax = useRef(0)
  const windowStart = useRef(0)

  useFrame((_, delta) => {
    if (activeView !== view) return
    const now = performance.now()
    if (windowStart.current === 0) {
      windowStart.current = now
      return
    }
    frames.current += 1
    frameMsMax.current = Math.max(frameMsMax.current, delta * 1000)

    const windowMs = now - windowStart.current
    if (windowMs < 1000) return

    const n = frames.current
    const fps = (n * 1000) / windowMs
    const info = gl.info
    const renders = drainRenderCounts()
    const rendersStr = Object.keys(renders)
      .sort()
      .map((k) => `${k}=${Math.round((renders[k] * 1000) / windowMs)}`)
      .join(' ')
    console.log(
      `perf - ${view} | ${fps.toFixed(0)} fps | max ${frameMsMax.current.toFixed(1)}ms` +
        ` | draws ${info.render.calls} | tris ${info.render.triangles}` +
        ` | renders/s ${rendersStr || '(none)'}`,
    )

    frames.current = 0
    frameMsMax.current = 0
    windowStart.current = now
  })

  return null
}
