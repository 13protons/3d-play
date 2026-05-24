import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Scene } from '../render/Scene'
import { VehicleScene } from '../render/VehicleScene'
import { HUD } from '../ui/HUD'
import { useInputStore } from '../state/input'
import { useTrajectoriesStore } from '../state/trajectories'
import { useModeStore } from '../state/mode'
import { stopSim } from '../state/bridge'
import { nextWarpRate, prevWarpRate } from '../sim/warp'
import {
  adjustThrottle,
  reactionWheelTorqueForKeys,
  throttleCut,
  throttleFull,
  toggledAttitudeMode,
} from '../sim/vehicle/controls'
import {
  throttleDirectionForKeyDown,
  throttleDirectionForKeyUp,
  throttlePresetForKeyDown,
  type ThrottleDirection,
} from './flightInput'

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

  useEffect(() => {
    throttleRef.current = currentThrottle
  }, [currentThrottle])

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
      if (e.key === 'm' || e.key === 'M') {
        useModeStore.getState().toggleView()
      }
      if (e.key === 't' || e.key === 'T') {
        const firstVehicle = Object.values(useTrajectoriesStore.getState().vehicles)[0]
        const currentMode = firstVehicle
          ? (useTrajectoriesStore.getState().vehicleControls[firstVehicle.id]?.attitudeMode ?? 'manual')
          : 'manual'
        useInputStore.getState().push({
          type: 'set-attitude-mode',
          mode: toggledAttitudeMode(currentMode, 'hold-current'),
          simTime,
        })
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
      if (e.key === 'Escape') {
        stopSim()
        useModeStore.getState().enterMenu()
        navigate('/main')
      }
    }
    function handleKeyUp(e: KeyboardEvent) {
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
    }
  }, [navigate])

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
