import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSimPaused, pauseSim, resumeSim } from '../bridge'
import { useTrajectoriesStore } from '../trajectories'

describe('bridge pause state', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resumeSim()
    useTrajectoriesStore.getState().reset()
  })

  it('pauses and resumes without changing the current warp rate', () => {
    useTrajectoriesStore.getState().setWarpRate(10)

    pauseSim()
    expect(isSimPaused()).toBe(true)
    expect(useTrajectoriesStore.getState().warpRate).toBe(10)

    resumeSim()
    expect(isSimPaused()).toBe(false)
    expect(useTrajectoriesStore.getState().warpRate).toBe(10)
  })

  it('freezes the read-side clock while paused and re-anchors on resume', () => {
    const store = useTrajectoriesStore.getState()
    const now = vi.spyOn(performance, 'now')

    // Anchor: sim-time 100 captured at wall-time 1000ms, warp 1×.
    now.mockReturnValue(1000)
    store.setWarpRate(1)
    store.updateCurves([], 100)

    // Unpaused: 1s of wall time interpolates to ~101.
    now.mockReturnValue(2000)
    expect(useTrajectoriesStore.getState().getSimTime()).toBeCloseTo(101, 6)

    // Paused: the clock freezes no matter how much wall time elapses.
    pauseSim()
    now.mockReturnValue(60_000)
    expect(useTrajectoriesStore.getState().getSimTime()).toBe(100)

    // Resume re-anchors to "now", so it continues from 100 without jumping
    // forward by the whole paused duration.
    resumeSim()
    expect(useTrajectoriesStore.getState().getSimTime()).toBeCloseTo(100, 6)
    now.mockReturnValue(61_000)
    expect(useTrajectoriesStore.getState().getSimTime()).toBeCloseTo(101, 6)
  })
})
