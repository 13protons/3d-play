import type { EulerOrder } from 'three'

type QuaternionTuple = [number, number, number, number]

const AERO_FORCE_MIN_VISIBLE = 1
const AERO_FORCE_SCALE = 5_000
const AERO_FORCE_MAX_LENGTH = 6

export function bodyRotationAngle(
  rotationPhase: number,
  angularVelocity: number,
  simTime: number,
): number {
  return rotationPhase + angularVelocity * simTime
}

export function bodyOrientationEuler(
  spinAngle: number,
  axialTiltDegrees: number,
): [number, number, number, EulerOrder] {
  return [0, spinAngle, (axialTiltDegrees * Math.PI) / 180, 'ZXY']
}

export type RotationLinePoints = [[number, number, number], [number, number, number]]
export type CraftDebugAxisSegments = {
  x: RotationLinePoints
  y: RotationLinePoints
  z: RotationLinePoints
  thrust: RotationLinePoints
  cot: [number, number, number]
}
export type RotationTransform = {
  groupPosition: [number, number, number]
  meshPosition: [number, number, number]
}

export function rotatingBodyTransform(
  scenePosition: [number, number, number],
): RotationTransform {
  return {
    groupPosition: scenePosition,
    meshPosition: [0, 0, 0],
  }
}

export function vehicleBodyTransform(
  scenePosition: [number, number, number],
): RotationTransform {
  return rotatingBodyTransform(scenePosition)
}

export function shouldShowRotationAxis(
  meshVisible: boolean,
  showRotationAxes: boolean,
): boolean {
  return meshVisible && showRotationAxes
}

export function shouldShowBodyRotationAxisInView(
  activeView: 'orbital' | 'vehicle',
  showRotationAxes: boolean,
): boolean {
  return activeView === 'orbital' && showRotationAxes
}

export function shouldShowRotationSurfaceMarker(meshVisible: boolean): boolean {
  void meshVisible
  return false
}

export function rotationAxisPoints(radius: number): RotationLinePoints {
  const halfLength = radius * 1.25
  return [
    [0, -halfLength, 0],
    [0, halfLength, 0],
  ]
}

export function craftDebugAxisSegments(axisLength: number): CraftDebugAxisSegments {
  const thrustLength = axisLength * 1.3
  return {
    x: [[-axisLength, 0, 0], [axisLength, 0, 0]],
    y: [[0, -axisLength, 0], [0, axisLength, 0]],
    z: [[0, 0, -axisLength], [0, 0, axisLength]],
    thrust: [[0, 0, 0], [0, 0, thrustLength]],
    cot: [0, 0, -thrustLength],
  }
}

export function craftDebugAeroForceSegment(
  force: [number, number, number] | undefined,
  craftOrientation: QuaternionTuple = [0, 0, 0, 1],
): RotationLinePoints | null {
  if (!force || !force.every(Number.isFinite)) return null
  const magnitude = Math.hypot(force[0], force[1], force[2])
  if (magnitude < AERO_FORCE_MIN_VISIBLE) return null

  const length = AERO_FORCE_MAX_LENGTH * (1 - Math.exp(-magnitude / AERO_FORCE_SCALE))
  const scale = length / magnitude
  const localForce = rotateVectorByQuaternion(force, [
    -craftOrientation[0],
    -craftOrientation[1],
    -craftOrientation[2],
    craftOrientation[3],
  ])
  return [
    [0, 0, 0],
    [localForce[0] * scale, localForce[1] * scale, localForce[2] * scale],
  ]
}

function rotateVectorByQuaternion(
  vector: [number, number, number],
  q: QuaternionTuple,
): [number, number, number] {
  const [x, y, z] = vector
  const [qx, qy, qz, qw] = q

  const ix = qw * x + qy * z - qz * y
  const iy = qw * y + qz * x - qx * z
  const iz = qw * z + qx * y - qy * x
  const iw = -qx * x - qy * y - qz * z

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

export function surfaceRotationMarkerPoints(radius: number): RotationLinePoints {
  const x = radius * 1.003
  const halfLength = radius * 0.25
  return [
    [x, -halfLength, 0],
    [x, halfLength, 0],
  ]
}
