import { useEffect, useRef } from 'react'
import { Scene } from '../render/Scene'
import { VehicleScene } from '../render/VehicleScene'
import { HUD } from '../ui/HUD'
import { useInputStore } from '../state/input'
import { useTrajectoriesStore } from '../state/trajectories'
import { useModeStore } from '../state/mode'
import { stopSim } from '../state/bridge'
import { nextWarpRate, prevWarpRate } from '../sim/warp'
import { angularVelocityForRcsKeys } from '../sim/vehicle/controls'

export function Flight() {
  const activeView = useModeStore((s) => s.activeView)
  const rcsKeysRef = useRef(new Set<string>())

  useEffect(() => {
    function pushRcsCommand() {
      const [pitch, yaw, roll] = angularVelocityForRcsKeys(rcsKeysRef.current)
      useInputStore.getState().push({
        type: 'set-attitude',
        pitch,
        yaw,
        roll,
        simTime: useTrajectoriesStore.getState().simTime,
      })
    }

    function handleKeyDown(e: KeyboardEvent) {
      const { warpRate, simTime } = useTrajectoriesStore.getState()
      if (e.repeat) return
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
      if (e.key === 'Shift') {
        useInputStore.getState().push({ type: 'set-throttle', value: 1, simTime })
      }
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(e.key.toLowerCase())) {
        rcsKeysRef.current.add(e.key.toLowerCase())
        pushRcsCommand()
      }
      if (e.key === 'Escape') {
        stopSim()
        useModeStore.getState().enterMenu()
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      const simTime = useTrajectoriesStore.getState().simTime
      if (e.key === 'Shift') {
        useInputStore.getState().push({ type: 'set-throttle', value: 0, simTime })
      }
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(e.key.toLowerCase())) {
        rcsKeysRef.current.delete(e.key.toLowerCase())
        pushRcsCommand()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
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
