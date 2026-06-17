/**
 * Live flight-debug overlay for a multi-part craft. Rendered as a child of the
 * Vessel's group, so it inherits the orientation rotation and the vehicle render
 * layer; everything here is in the body frame, positioned relative to the center
 * of mass and scaled into scene units the same way the parts are. The
 * thrust/drag rays are scaled by magnitude (shared scale, so thrust vs drag is
 * directly comparable); torque has its own scale. Lengths are capped so an
 * extreme value can't shoot off to infinity. Exact magnitudes live in the panel.
 *
 * It subscribes to the high-frequency control telemetry on its own throttled
 * cadence so refreshing the vectors doesn't re-render the whole Vessel tree.
 */

import { Line } from '@react-three/drei'
import { useTrajectoriesStore } from '../state/trajectories'
import { useThrottledRender } from '../ui/useThrottledRender'
import { type Mat3, type Quaternion, type Vec3, mat3FromQuaternion, mat3MulVec, mat3Transpose } from '../sim/vehicle/mat3'

/** An engine's mount + nominal thrust axis (body frame) and its staging group. */
export interface DebugEngine {
  position: Vec3
  direction: Vec3
  stage: number
}

interface FlightDebugOverlayProps {
  vehicleId: string
  /** Metres → scene units (matches the Vessel). */
  scale: number
  engines: DebugEngine[]
}

const COLORS = {
  com: '#ffffff',
  cop: '#ff4df8',
  axisX: '#ff6b6b',
  axisY: '#7dff7a',
  axisZ: '#5ecbff',
  engine: '#ffcd70',
  thrust: '#ff8a18',
  torque: '#c08bff',
  drag: '#ff4df8',
}

const AXIS_LEN = 6
/** Newtons per scene unit (shared by thrust + drag so their lengths compare). */
const FORCE_PER_UNIT = 175_000
/** N·m per scene unit for the torque ray. */
const TORQUE_PER_UNIT = 150_000
/** Cap on any ray's length (scene units) so an extreme value stays on-screen-ish. */
const MAX_RAY_LEN = 40

function norm(v: Vec3): Vec3 | null {
  const m = Math.hypot(v[0], v[1], v[2])
  if (!(m > 0) || !Number.isFinite(m)) return null
  return [v[0] / m, v[1] / m, v[2] / m]
}

/** Rotate a world-frame vector into the body frame (Rᵀ·w). */
function worldToBody(world: Vec3, orientation: Quaternion): Vec3 {
  const rt: Mat3 = mat3Transpose(mat3FromQuaternion(orientation))
  return mat3MulVec(rt, world)
}

export function FlightDebugOverlay({ vehicleId, scale, engines }: FlightDebugOverlayProps) {
  useThrottledRender(15)
  const controls = useTrajectoriesStore.getState().vehicleControls[vehicleId]
  if (!controls) return null

  const com = controls.centerOfMass ?? [0, 0, 0]
  const stage = controls.currentStage ?? 0
  const dragBody = controls.aeroForceWorld ? worldToBody(controls.aeroForceWorld, controls.orientation) : undefined

  // Body point → scene position relative to the CoM (which sits at the origin).
  const at = (p: Vec3): [number, number, number] => [
    (p[0] - com[0]) * scale,
    (p[1] - com[1]) * scale,
    (p[2] - com[2]) * scale,
  ]
  const origin: [number, number, number] = [0, 0, 0]
  // Fixed-length direction indicator (used for the engines' nominal axes).
  const dirRay = (v: Vec3 | undefined, length: number): [number, number, number][] | null => {
    if (!v) return null
    const u = norm(v)
    return u ? [origin, [u[0] * length, u[1] * length, u[2] * length]] : null
  }
  // Magnitude-scaled ray: length = |v| / perUnit, capped. Tiny force → tiny ray,
  // none → nothing, so the lengths read as actual relative magnitudes.
  const scaledRay = (v: Vec3 | undefined, perUnit: number): [number, number, number][] | null => {
    if (!v) return null
    const m = Math.hypot(v[0], v[1], v[2])
    const u = norm(v)
    if (!u || !(m > 0)) return null
    const len = Math.min(m / perUnit, MAX_RAY_LEN)
    return [origin, [u[0] * len, u[1] * len, u[2] * len]]
  }

  const thrustRay = scaledRay(controls.thrustBody, FORCE_PER_UNIT)
  const torqueRay = scaledRay(controls.torqueBody, TORQUE_PER_UNIT)
  const dragRay = scaledRay(dragBody, FORCE_PER_UNIT)

  return (
    <group>
      <mesh>
        <sphereGeometry args={[0.4, 12, 8]} />
        <meshBasicMaterial color={COLORS.com} depthTest={false} />
      </mesh>
      {/* Center of pressure: drag acts here; its offset from the CoM (origin) is
          the stability arm — behind the CoM weathervanes, ahead tumbles. */}
      {controls.centerOfPressure && (
        <mesh position={at(controls.centerOfPressure)}>
          <sphereGeometry args={[0.35, 12, 8]} />
          <meshBasicMaterial color={COLORS.cop} depthTest={false} />
        </mesh>
      )}
      <Line points={[[-AXIS_LEN, 0, 0], [AXIS_LEN, 0, 0]]} color={COLORS.axisX} lineWidth={1.5} depthTest={false} depthWrite={false} />
      <Line points={[[0, -AXIS_LEN, 0], [0, AXIS_LEN, 0]]} color={COLORS.axisY} lineWidth={1.5} depthTest={false} depthWrite={false} />
      <Line points={[[0, 0, -AXIS_LEN], [0, 0, AXIS_LEN]]} color={COLORS.axisZ} lineWidth={1.5} depthTest={false} depthWrite={false} />

      {engines.map((e, i) => {
        const dir = dirRay(e.direction, 3)
        return (
          <group key={i} position={at(e.position)}>
            <mesh>
              <sphereGeometry args={[0.5, 12, 8]} />
              <meshBasicMaterial color={COLORS.engine} depthTest={false} transparent opacity={e.stage === stage ? 1 : 0.4} />
            </mesh>
            {dir && <Line points={dir} color={COLORS.engine} lineWidth={1} depthTest={false} depthWrite={false} />}
          </group>
        )
      })}

      {thrustRay && <Line points={thrustRay} color={COLORS.thrust} lineWidth={3} depthTest={false} depthWrite={false} />}
      {torqueRay && <Line points={torqueRay} color={COLORS.torque} lineWidth={3} depthTest={false} depthWrite={false} />}
      {dragRay && <Line points={dragRay} color={COLORS.drag} lineWidth={3} depthTest={false} depthWrite={false} />}
    </group>
  )
}
