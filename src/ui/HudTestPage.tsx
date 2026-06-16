import type GUI from 'lil-gui'
import type { ReactNode } from 'react'
import {
  ANGULAR_RATE_DANGER_THRESHOLD_RAD_PER_SECOND,
  ANGULAR_RATE_SCALE_RAD_PER_SECOND,
} from './magnitudeIndicatorMath'
import { MagnitudeIndicator } from './MagnitudeIndicator'
import { Attitude, NavballInstrument, Proximity } from './Navball'
import { computeFlightReadout, flightTelemetryRows } from './flightReadout'
import { HudPlaygroundBootstrap } from './HudPlaygroundBootstrap'
import { computeForceLoadRatio } from './navballInstrumentMath'
import { eulerDegreesToQuaternion, type Quaternion } from './navballMath'

import type { AutopilotMode } from '../sim/autopilot'

type HudSurfaceState = 'flying' | 'landed' | 'crashed'
type HudOrbitKind = 'closed' | 'open' | 'impacting'
type HudReferenceMode = 'orbital' | 'surface'

interface HudPlaygroundParams {
  mode: HudReferenceMode
  surfaceState: HudSurfaceState
  autopilotMode: AutopilotMode
  throttle: number
  altitudeMeters: number
  speedMetersPerSecond: number
  verticalSpeedMetersPerSecond: number
  massKg: number
  thrustNewtons: number
  aeroForceNewtons: number
  pitchRate: number
  yawRate: number
  rollRate: number
  yawDegrees: number
  pitchDegrees: number
  rollDegrees: number
  orbitKind: HudOrbitKind
  periapsisAltitudeMeters: number
  apoapsisAltitudeMeters: number
  showApoapsis: boolean
}

const initialHudParams: HudPlaygroundParams = {
  mode: 'orbital',
  surfaceState: 'flying',
  autopilotMode: 'damp',
  throttle: 0.62,
  altitudeMeters: 400_000,
  speedMetersPerSecond: 7_672,
  verticalSpeedMetersPerSecond: 0,
  massKg: 9_000,
  thrustNewtons: 180_000,
  aeroForceNewtons: 0,
  pitchRate: 3.21,
  yawRate: -6.3,
  rollRate: 6.3,
  yawDegrees: 0,
  pitchDegrees: 0,
  rollDegrees: 0,
  orbitKind: 'closed',
  periapsisAltitudeMeters: 112_000,
  apoapsisAltitudeMeters: 430_000,
  showApoapsis: true,
}

export function HudTestPage() {
  return (
    <div
      style={{
        position: 'relative',
        height: '100vh',
        overflowX: 'hidden',
        overflowY: 'auto',
        background: 'radial-gradient(circle at 50% 35%, #18243d 0%, #070912 52%, #020308 100%)',
        color: 'white',
        fontFamily: 'monospace',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.32) 1px, transparent 1px)',
          backgroundSize: '88px 88px',
          opacity: 0.13,
        }}
      />
      <div style={{ position: 'relative', padding: 20 }}>
        <div style={{ opacity: 0.55, fontSize: 11, letterSpacing: 1.4 }}>/_TEST/HUD</div>
        <h1 style={{ margin: '6px 0 4px', fontWeight: 300 }}>HUD Playground</h1>
        <div style={{ opacity: 0.65, maxWidth: 680 }}>
          Focused nav UI sandbox. Each bootstrap owns parameters and pushes them into its component.
        </div>
      </div>

      <HudPlaygroundBootstrap
        title="Proximity"
        initialParams={initialHudParams}
        configure={configureProximityControls}
        previewMinHeight={220}
      >
        {(params) => <Centered><Proximity rows={hudRows(params).slice(0, 3)} /></Centered>}
      </HudPlaygroundBootstrap>

      <HudPlaygroundBootstrap
        title="Navball"
        initialParams={initialHudParams}
        configure={configureNavballControls}
        previewMinHeight={340}
      >
        {(params) => (
          <Centered>
            <NavballInstrument
              orientation={orientationFromParams(params)}
              relativePosition={[1, 0, 0]}
              relativeVelocity={[0, 0, params.speedMetersPerSecond]}
              parentRotationAxis={[0, 1, 0]}
              mode={params.mode}
              throttle={params.throttle}
              forceRatio={computeForceLoadRatio({
                currentThrust: params.thrustNewtons,
                aeroForceWorld: [params.aeroForceNewtons, 0, 0],
                mass: params.massKg,
              })}
              surfaceState={params.surfaceState}
              autopilotMode={params.autopilotMode}
              orbit={orbitFromParams(params)}
            />
          </Centered>
        )}
      </HudPlaygroundBootstrap>

      <HudPlaygroundBootstrap
        title="Attitude"
        initialParams={initialHudParams}
        configure={configureAttitudeControls}
        previewMinHeight={300}
      >
        {(params) => <Centered><Attitude rows={hudRows(params).slice(3)} /></Centered>}
      </HudPlaygroundBootstrap>

      <HudPlaygroundBootstrap
        title="Angular Rates"
        initialParams={initialHudParams}
        configure={configureAngularRateControls}
        previewMinHeight={160}
      >
        {(params) => (
          <Centered>
            <div style={{ display: 'grid', gap: 4 }}>
              <MagnitudeIndicator label="PITCH" value={params.pitchRate} min={-ANGULAR_RATE_SCALE_RAD_PER_SECOND} max={ANGULAR_RATE_SCALE_RAD_PER_SECOND} unit="rad/s" dangerThreshold={ANGULAR_RATE_DANGER_THRESHOLD_RAD_PER_SECOND} />
              <MagnitudeIndicator label="ROLL" value={params.rollRate} min={-ANGULAR_RATE_SCALE_RAD_PER_SECOND} max={ANGULAR_RATE_SCALE_RAD_PER_SECOND} unit="rad/s" dangerThreshold={ANGULAR_RATE_DANGER_THRESHOLD_RAD_PER_SECOND} />
              <MagnitudeIndicator label="YAW" value={params.yawRate} min={-ANGULAR_RATE_SCALE_RAD_PER_SECOND} max={ANGULAR_RATE_SCALE_RAD_PER_SECOND} unit="rad/s" dangerThreshold={ANGULAR_RATE_DANGER_THRESHOLD_RAD_PER_SECOND} />
              <div style={{ color: 'rgba(255,255,255,0.82)', fontFamily: 'sans-serif', fontSize: 11, marginLeft: 4 }}>
                Rotation Rate - rad/s
              </div>
            </div>
          </Centered>
        )}
      </HudPlaygroundBootstrap>

    </div>
  )
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
      {children}
    </div>
  )
}

function hudRows(params: HudPlaygroundParams) {
  const parentRadius = 6_371_000
  const radialDistance = parentRadius + params.altitudeMeters
  const readout = computeFlightReadout({
    vehiclePosition: [radialDistance, 0, 0],
    vehicleVelocity: [params.verticalSpeedMetersPerSecond, 0, params.speedMetersPerSecond],
    parentPosition: [0, 0, 0],
    parentVelocity: [0, 0, 0],
    parentRadius,
    referenceVelocity: [params.verticalSpeedMetersPerSecond, 0, params.speedMetersPerSecond],
  })
  return flightTelemetryRows({
    readout,
    throttle: params.throttle,
    angularVelocity: [params.pitchRate, params.yawRate, params.rollRate],
    surfaceState: params.surfaceState,
    autopilotMode: params.autopilotMode,
    mass: params.massKg,
    maxThrust: params.thrustNewtons,
  })
}

function orbitFromParams(params: HudPlaygroundParams) {
  return {
    kind: params.orbitKind,
    periapsisAltitude: params.periapsisAltitudeMeters,
    apoapsisAltitude: params.showApoapsis ? params.apoapsisAltitudeMeters : null,
  }
}

function orientationFromParams(params: HudPlaygroundParams): Quaternion {
  return eulerDegreesToQuaternion({
    yaw: params.yawDegrees,
    pitch: params.pitchDegrees,
    roll: params.rollDegrees,
  })
}

function configureProximityControls(gui: GUI, params: HudPlaygroundParams, update: () => void) {
  gui.add(params, 'altitudeMeters', -1_000, 1_000_000, 1_000).name('Altitude m').onChange(update)
  gui.add(params, 'speedMetersPerSecond', 0, 12_000, 10).name('Speed m/s').onChange(update)
}

function configureNavballControls(gui: GUI, params: HudPlaygroundParams, update: () => void) {
  gui.add(params, 'mode', ['orbital', 'surface']).name('Regime').onChange(update)
  gui.add(params, 'surfaceState', ['flying', 'landed', 'crashed']).name('State').onChange(update)
  gui.add(params, 'autopilotMode', ['off', 'damp', 'prograde', 'retrograde', 'normal', 'antinormal', 'radial-out', 'radial-in']).name('Autopilot').onChange(update)
  gui.add(params, 'throttle', 0, 1, 0.01).name('Throttle').onChange(update)
  gui.add(params, 'thrustNewtons', 0, 1_000_000, 1_000).name('Force N').onChange(update)
  gui.add(params, 'aeroForceNewtons', 0, 1_000_000, 1_000).name('Aero force N').onChange(update)
  gui.add(params, 'speedMetersPerSecond', 0, 12_000, 10).name('Prograde m/s').onChange(update)
  addAttitudeControls(gui, params, update)
}

function configureAttitudeControls(gui: GUI, params: HudPlaygroundParams, update: () => void) {
  gui.add(params, 'verticalSpeedMetersPerSecond', -1_000, 1_000, 1).name('Vertical m/s').onChange(update)
  gui.add(params, 'massKg', 100, 100_000, 100).name('Mass kg').onChange(update)
  gui.add(params, 'pitchRate', -1, 1, 0.01).name('Pitch rate').onChange(update)
  gui.add(params, 'yawRate', -1, 1, 0.01).name('Yaw rate').onChange(update)
  gui.add(params, 'rollRate', -1, 1, 0.01).name('Roll rate').onChange(update)
  gui.add(params, 'orbitKind', ['closed', 'open', 'impacting']).name('Orbit kind').onChange(update)
  gui.add(params, 'periapsisAltitudeMeters', -6_371_000, 1_000_000, 1_000).name('PE m').onChange(update)
  gui.add(params, 'showApoapsis').name('Show AP').onChange(update)
  gui.add(params, 'apoapsisAltitudeMeters', -6_371_000, 2_000_000, 1_000).name('AP m').onChange(update)
}

function configureAngularRateControls(gui: GUI, params: HudPlaygroundParams, update: () => void) {
  gui.add(params, 'pitchRate', -ANGULAR_RATE_SCALE_RAD_PER_SECOND, ANGULAR_RATE_SCALE_RAD_PER_SECOND, 0.05).name('Pitch rate').onChange(update)
  gui.add(params, 'rollRate', -ANGULAR_RATE_SCALE_RAD_PER_SECOND, ANGULAR_RATE_SCALE_RAD_PER_SECOND, 0.05).name('Roll rate').onChange(update)
  gui.add(params, 'yawRate', -ANGULAR_RATE_SCALE_RAD_PER_SECOND, ANGULAR_RATE_SCALE_RAD_PER_SECOND, 0.05).name('Yaw rate').onChange(update)
}

function addAttitudeControls(gui: GUI, params: HudPlaygroundParams, update: () => void) {
  const attitude = gui.addFolder('Attitude')
  attitude.add(params, 'yawDegrees', -180, 180, 1).name('Yaw deg').onChange(update)
  attitude.add(params, 'pitchDegrees', -180, 180, 1).name('Pitch deg').onChange(update)
  attitude.add(params, 'rollDegrees', -180, 180, 1).name('Roll deg').onChange(update)
}
