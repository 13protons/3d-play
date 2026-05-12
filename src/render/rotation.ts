export function bodyRotationAngle(
  rotationPhase: number,
  angularVelocity: number,
  simTime: number,
): number {
  return rotationPhase + angularVelocity * simTime
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

export function surfaceRotationMarkerPoints(radius: number): RotationLinePoints {
  const x = radius * 1.003
  const halfLength = radius * 0.25
  return [
    [x, -halfLength, 0],
    [x, halfLength, 0],
  ]
}
