export function cameraUpLerpAlpha(deltaSeconds: number, settleSeconds = 1.25): number {
  if (deltaSeconds <= 0 || settleSeconds <= 0) return 0
  return Math.min(1, deltaSeconds / settleSeconds)
}
