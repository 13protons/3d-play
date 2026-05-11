export function bodyRotationAngle(
  rotationPhase: number,
  angularVelocity: number,
  simTime: number,
): number {
  return rotationPhase + angularVelocity * simTime
}

export type RotationLinePoints = [[number, number, number], [number, number, number]]

export function shouldShowRotationAxis(
  meshVisible: boolean,
  showRotationAxes: boolean,
): boolean {
  return meshVisible && showRotationAxes
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

export function surfaceRotationMarkerPoints(radius: number): RotationLinePoints {
  const x = radius * 1.003
  const halfLength = radius * 0.25
  return [
    [x, -halfLength, 0],
    [x, halfLength, 0],
  ]
}
