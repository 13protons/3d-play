import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Scene } from '../render/Scene'
import { VehicleScene } from '../render/VehicleScene'
import { HUD } from '../ui/HUD'
import { useInputStore } from '../state/input'
import { useTrajectoriesStore } from '../state/trajectories'
import { useModeStore } from '../state/mode'
import { pauseSim, resumeSim, stopSim } from '../state/bridge'
import { nextWarpRate, prevWarpRate } from '../sim/warp'
import {
  adjustThrottle,
  reactionWheelTorqueForKeys,
  throttleCut,
  throttleFull,
} from '../sim/vehicle/controls'
import { useAutopilotStore } from '../state/autopilot'
import {
  throttleDirectionForKeyDown,
  throttleDirectionForKeyUp,
  throttlePresetForKeyDown,
  type ThrottleDirection,
} from './flightInput'
import {
  nextPauseMenuStateForEscape,
  shouldProcessFlightControlKey,
} from './flightPause'

export function Flight() {
  const navigate = useNavigate()
  const activeView = useModeStore((s) => s.activeView)
  const currentThrottle = useTrajectoriesStore((s) => {
    const firstVehicle = Object.values(s.vehicles)[0]
    return firstVehicle ? (s.vehicleControls[firstVehicle.id]?.throttle ?? 0) : 0
  })
  const reactionWheelKeysRef = useRef(new Set<string>())
  const throttleRef = useRef(0)
  const throttleDirectionRef = useRef<ThrottleDirection>(0)
  const reactionWheelTorqueRef = useRef<[number, number, number]>([0.25, 0.25, 0.25])
  const [paused, setPaused] = useState(false)
  const pausedRef = useRef(false)

  useEffect(() => {
    throttleRef.current = currentThrottle
  }, [currentThrottle])

  useEffect(() => {
    pausedRef.current = paused
    if (paused) pauseSim()
    else resumeSim()
  }, [paused])

  useEffect(() => {
    let animationFrame: number | null = null
    let previousWallTime = performance.now()

    function pushThrottleCommand(value: number, simTime: number) {
      throttleRef.current = value
      useInputStore.getState().push({
        type: 'set-throttle',
        value,
        simTime,
      })
    }

    function rampThrottle(now: number) {
      const elapsedSeconds = (now - previousWallTime) / 1000
      previousWallTime = now
      const direction = throttleDirectionRef.current
      if (direction !== 0) {
        const { simTime } = useTrajectoriesStore.getState()
        const nextThrottle = adjustThrottle(throttleRef.current, direction, elapsedSeconds)
        if (nextThrottle !== throttleRef.current) pushThrottleCommand(nextThrottle, simTime)
      }
      animationFrame = requestAnimationFrame(rampThrottle)
    }

    animationFrame = requestAnimationFrame(rampThrottle)

    function pushRcsCommand() {
      const firstVehicle = Object.values(useTrajectoriesStore.getState().vehicles)[0]
      if (firstVehicle) {
        const controls = useTrajectoriesStore.getState().vehicleControls[firstVehicle.id]
        if (controls?.reactionWheelTorque) reactionWheelTorqueRef.current = controls.reactionWheelTorque
      }
      const [pitch, yaw, roll] = reactionWheelTorqueForKeys(reactionWheelKeysRef.current, reactionWheelTorqueRef.current)
      useInputStore.getState().push({
        type: 'set-attitude',
        pitch,
        yaw,
        roll,
        simTime: useTrajectoriesStore.getState().simTime,
      })
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '?') {
        if (!e.repeat) {
          e.preventDefault()
          useModeStore.getState().toggleKeyboardShortcuts()
        }
        return
      }
      if (!shouldProcessFlightControlKey({ paused: pausedRef.current, key: e.key })) return
      const { warpRate, simTime } = useTrajectoriesStore.getState()
      if (e.repeat) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setPaused((value) => {
          const nextPaused = nextPauseMenuStateForEscape(value)
          if (nextPaused) releaseHeldControls()
          return nextPaused
        })
        return
      }
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
      if (e.key === 'm' || e.key === 'M') {
        useModeStore.getState().toggleView()
      }
      if (e.key === 't' || e.key === 'T') {
        const firstVehicle = Object.values(useTrajectoriesStore.getState().vehicles)[0]
        if (firstVehicle) useAutopilotStore.getState().toggleMode(firstVehicle.id, 'damp')
      }
      if (e.key === ' ') {
        // Fire the next stage (no-op in the worker if nothing is left to drop).
        e.preventDefault()
        useInputStore.getState().push({ type: 'stage', simTime })
      }
      const throttlePreset = throttlePresetForKeyDown(e)
      if (throttlePreset === 'full') {
        e.preventDefault()
        pushThrottleCommand(throttleFull(), simTime)
      }
      if (throttlePreset === 'cut') {
        e.preventDefault()
        pushThrottleCommand(throttleCut(), simTime)
      }
      throttleDirectionRef.current = throttleDirectionForKeyDown(throttleDirectionRef.current, e)
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(e.key.toLowerCase())) {
        reactionWheelKeysRef.current.add(e.key.toLowerCase())
        pushRcsCommand()
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (pausedRef.current) return
      throttleDirectionRef.current = throttleDirectionForKeyUp(throttleDirectionRef.current, e)
      if (['w', 'a', 's', 'd', 'q', 'e'].includes(e.key.toLowerCase())) {
        reactionWheelKeysRef.current.delete(e.key.toLowerCase())
        pushRcsCommand()
      }
    }
    function releaseHeldControls() {
      throttleDirectionRef.current = 0
      reactionWheelKeysRef.current.clear()
      pushRcsCommand()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', releaseHeldControls)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', releaseHeldControls)
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      resumeSim()
    }
  }, [navigate])

  function resumeFlight() {
    setPaused(false)
  }

  function exitFlight() {
    stopSim()
    useModeStore.getState().enterMenu()
    navigate('/main')
  }

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
      {paused && <PauseMenu onResume={resumeFlight} onExit={exitFlight} />}
    </div>
  )
}

function PauseMenu({
  onResume,
  onExit,
}: {
  onResume: () => void
  onExit: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-title"
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0, 0, 0, 0.58)',
        color: '#d8f8ff',
        zIndex: 20,
      }}
    >
      <div style={{
        minWidth: 280,
        border: '1px solid rgba(120, 230, 255, 0.45)',
        borderRadius: 12,
        background: 'rgba(5, 13, 24, 0.92)',
        boxShadow: '0 0 42px rgba(60, 210, 255, 0.18)',
        padding: 24,
        textAlign: 'center',
      }}>
        <h2 id="pause-title" style={{ margin: '0 0 16px', letterSpacing: 4, textTransform: 'uppercase' }}>Paused</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <button type="button" onClick={onResume}>Resume</button>
          <button type="button" onClick={onExit}>Exit to Menu</button>
        </div>
      </div>
    </div>
  )
}
