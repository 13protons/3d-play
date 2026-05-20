import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { useInputStore } from '../state/input'
import { useModeStore } from '../state/mode'
import { WARP_RATES } from '../sim/warp'
import { evaluateCurve, evaluateCurveVelocity } from '../sim/curves'
import { computeFlightReadout, flightTelemetryRows } from './flightReadout'
import { NavballCluster } from './Navball'
import {
  computeFlightReferenceFrame,
  rotationAxisFromAxialTilt,
} from '../sim/vehicle/referenceFrame'

function formatTime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function HUD() {
  const simTime = useTrajectoriesStore((s) => s.simTime)
  const warpRate = useTrajectoriesStore((s) => s.warpRate)
  const bodies = useTrajectoriesStore((s) => s.bodies)
  const vehicles = useTrajectoriesStore((s) => s.vehicles)
  const curves = useTrajectoriesStore((s) => s.curves)
  const vehicleControls = useTrajectoriesStore((s) => s.vehicleControls)
  const followTargetId = useCameraStore((s) => s.followTargetId)
  const setFollowTarget = useCameraStore((s) => s.setFollowTarget)
  const activeView = useModeStore((s) => s.activeView)
  const showRotationAxes = useModeStore((s) => s.showRotationAxes)
  const toggleView = useModeStore((s) => s.toggleView)
  const toggleRotationAxes = useModeStore((s) => s.toggleRotationAxes)
  const targetName = bodies[followTargetId]?.name ?? vehicles[followTargetId]?.name ?? followTargetId
  const firstVehicle = Object.values(vehicles)[0]
  const throttle = firstVehicle ? (vehicleControls[firstVehicle.id]?.throttle ?? 0) : 0
  const vehicleCurve = firstVehicle ? curves[firstVehicle.id] : undefined
  const parent = firstVehicle ? bodies[firstVehicle.parentId] : undefined
  const parentCurve = firstVehicle ? curves[firstVehicle.parentId] : undefined
  const vehiclePosition = vehicleCurve ? evaluateCurve(vehicleCurve, simTime) : null
  const parentPosition = parentCurve ? evaluateCurve(parentCurve, simTime) : null
  const vehicleVelocity = vehicleCurve ? evaluateCurveVelocity(vehicleCurve, simTime) : null
  const parentVelocity = parentCurve ? evaluateCurveVelocity(parentCurve, simTime) : null
  const relativePosition = vehiclePosition && parentPosition
    ? [
        vehiclePosition[0] - parentPosition[0],
        vehiclePosition[1] - parentPosition[1],
        vehiclePosition[2] - parentPosition[2],
      ] as [number, number, number]
    : null
  const vehicleControl = firstVehicle ? vehicleControls[firstVehicle.id] : undefined
  const flightReadout = firstVehicle && parent && vehicleCurve && parentCurve
    ? (() => {
        const vPos = vehiclePosition ?? evaluateCurve(vehicleCurve, simTime)
        const vVel = vehicleVelocity ?? vehicleCurve.v1
        const pPos = parentPosition ?? evaluateCurve(parentCurve, simTime)
        const pVel = parentVelocity ?? parentCurve.v1
        const relPos = [vPos[0] - pPos[0], vPos[1] - pPos[1], vPos[2] - pPos[2]] as [number, number, number]
        const relVel = [vVel[0] - pVel[0], vVel[1] - pVel[1], vVel[2] - pVel[2]] as [number, number, number]
        const frame = computeFlightReferenceFrame({
          relativePosition: relPos,
          relativeVelocity: relVel,
          parentRadius: parent.radius,
          parentGm: parent.gm,
          parentAngularVelocity: parent.angularVelocity,
          parentRotationAxis: rotationAxisFromAxialTilt(parent.axialTilt),
          surfaceState: vehicleControl?.surfaceState ?? 'flying',
        })
        return {
          readout: computeFlightReadout({
            vehiclePosition: vPos,
            vehicleVelocity: vVel,
            parentPosition: pPos,
            parentVelocity: pVel,
            parentRadius: parent.radius,
            referenceVelocity: frame.navVelocity,
          }),
          frame,
        }
      })()
    : null

  function setWarp(rate: number) {
    useInputStore
      .getState()
      .push({ type: 'set-warp', rate, simTime })
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: 16,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: 14,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', gap: 32 }}>
        <div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>SIM TIME</div>
          <div>T+ {formatTime(simTime)}</div>
        </div>
        <div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>WARP</div>
          <div>{warpRate}x</div>
        </div>
        <div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>FOLLOWING</div>
          <div>{targetName}</div>
        </div>
        <div>
          <div style={{ opacity: 0.6, fontSize: 11 }}>VIEW</div>
          <div>{activeView.toUpperCase()}</div>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 8,
          pointerEvents: 'auto',
        }}
      >
        {Object.values(bodies).map((body) => (
          <button
            key={body.id}
            onClick={() => setFollowTarget(body.id)}
            style={{
              padding: '4px 10px',
              background:
                body.id === followTargetId
                  ? 'rgba(255,255,255,0.25)'
                  : 'rgba(255,255,255,0.08)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.3)',
              borderRadius: 4,
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            {body.name}
          </button>
        ))}
        {Object.values(vehicles).map((v) => (
          <button
            key={v.id}
            onClick={() => setFollowTarget(v.id)}
            style={{
              background: followTargetId === v.id ? '#335533' : '#1a1a2e',
              color: followTargetId === v.id ? '#88ff88' : '#ccc',
              border: '1px solid #333',
              padding: '4px 8px',
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
          >
            {v.name}
          </button>
        ))}
        <button
          onClick={toggleView}
          style={{
            background: '#1a1a2e',
            color: '#ccc',
            border: '1px solid #333',
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Toggle View (V)
        </button>
        <button
          onClick={toggleRotationAxes}
          style={{
            background: showRotationAxes ? 'rgba(255,255,255,0.25)' : '#1a1a2e',
            color: '#ccc',
            border: '1px solid #333',
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'monospace',
            fontSize: 12,
          }}
        >
          Rotation Axis: {showRotationAxes ? 'On' : 'Off'}
        </button>
      </div>

      <div
        style={{
          marginTop: 12,
          display: 'flex',
          gap: 4,
          pointerEvents: 'auto',
        }}
      >
        {WARP_RATES.map((rate) => (
          <button
            key={rate}
            onClick={() => setWarp(rate)}
            style={{
              padding: '2px 8px',
              background:
                rate === warpRate
                  ? 'rgba(100,180,255,0.35)'
                  : 'rgba(255,255,255,0.08)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 11,
            }}
          >
            {rate}x
          </button>
        ))}
      </div>

      <div style={{ marginTop: 8, opacity: 0.4, fontSize: 11 }}>
        [ / ] warp &nbsp; Z toggle thrust &nbsp; WASD/QE reaction wheel &nbsp; V toggle view
        &nbsp; scroll to zoom &nbsp; drag to orbit &nbsp; esc menu
      </div>
      {vehicleControl && relativePosition && flightReadout && (
        <NavballCluster
          orientation={vehicleControl.orientation}
          relativePosition={relativePosition}
          relativeVelocity={flightReadout.frame.navVelocity}
          mode={flightReadout.frame.mode}
          rows={flightTelemetryRows({
            readout: flightReadout.readout,
            throttle,
            angularVelocity: vehicleControl.angularVelocity,
            surfaceState: vehicleControl.surfaceState,
          })}
        />
      )}
    </div>
  )
}
