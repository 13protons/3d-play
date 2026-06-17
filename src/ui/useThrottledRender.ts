import { useEffect, useState } from 'react'

/**
 * Forces a re-render at up to `hz` times per second via requestAnimationFrame.
 *
 * Pairs with `getState()` reads to put a component on its own render cadence —
 * the same decoupling the 3D layer gets from `useFrame` — instead of
 * subscribing to high-frequency store updates and re-rendering on every write.
 * rAF means it also pauses when the tab is hidden.
 */
export function useThrottledRender(hz: number): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    let raf = 0
    let last = 0
    const interval = 1000 / hz
    const loop = (now: number) => {
      if (now - last >= interval) {
        last = now
        setTick((n) => (n + 1) % 1_000_000)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [hz])
}
