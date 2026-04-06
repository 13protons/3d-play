import { useEffect } from 'react'
import { Scene } from '../render/Scene'
import { VehicleScene } from '../render/VehicleScene'
import { HUD } from '../ui/HUD'
import { useInputStore } from '../state/input'
import { useTrajectoriesStore } from '../state/trajectories'
import { useModeStore } from '../state/mode'
import { stopSim } from '../state/bridge'
import { nextWarpRate, prevWarpRate } from '../sim/warp'

export function Flight() {
  const activeView = useModeStore((s) => s.activeView)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const { warpRate, simTime } = useTrajectoriesStore.getState()
      if (e.key === ']') {
        useInputStore
          .getState()
          .push({ type: 'set-warp', rate: nextWarpRate(warpRate), simTime })
      }
      if (e.key === '[') {
        useInputStore
          .getState()
          .push({ type: 'set-warp', rate: prevWarpRate(warpRate), simTime })
      }
      if (e.key === 'v' || e.key === 'V') {
        useModeStore.getState().toggleView()
      }
      if (e.key === 'Escape') {
        stopSim()
        useModeStore.getState().enterMenu()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        display: activeView === 'orbital' ? 'block' : 'none',
      }}>
        <Scene />
      </div>
      <VehicleScene />
      <HUD />
    </div>
  )
}
