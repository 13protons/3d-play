/**
 * Imperative bridge to the active orbital camera.
 *
 * The scene renders relative to the follow target, so the camera's position and
 * the OrbitControls target are already expressed *relative to that focal point*.
 * Capturing and restoring them across a sim restart therefore preserves the
 * exact viewing angle and distance to the subject — the scene editor uses this
 * so a restart-on-apply doesn't fling the camera off the vehicle.
 *
 * `CameraRig` registers the live handle; consumers call the module functions.
 * No-ops gracefully when no rig is mounted.
 */

export interface CameraPose {
  position: [number, number, number]
  target: [number, number, number]
}

interface CameraControlHandle {
  capture: () => CameraPose | null
  restore: (pose: CameraPose) => void
}

let handle: CameraControlHandle | null = null

export function registerCameraControl(next: CameraControlHandle): () => void {
  handle = next
  return () => {
    if (handle === next) handle = null
  }
}

export function captureCameraPose(): CameraPose | null {
  return handle?.capture() ?? null
}

export function restoreCameraPose(pose: CameraPose): void {
  handle?.restore(pose)
}
