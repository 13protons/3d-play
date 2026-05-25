import { describe, expect, it } from 'vitest'
import { isSimPaused, pauseSim, resumeSim } from '../bridge'
import { useTrajectoriesStore } from '../trajectories'

describe('bridge pause state', () => {
  it('pauses and resumes without changing the current warp rate', () => {
    useTrajectoriesStore.getState().setWarpRate(10)

    pauseSim()
    expect(isSimPaused()).toBe(true)
    expect(useTrajectoriesStore.getState().warpRate).toBe(10)

    resumeSim()
    expect(isSimPaused()).toBe(false)
    expect(useTrajectoriesStore.getState().warpRate).toBe(10)
  })
})
