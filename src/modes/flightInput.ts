export type ThrottleDirection = -1 | 0 | 1

export interface FlightKeyEvent {
  key: string
  metaKey?: boolean
  altKey?: boolean
}

export function throttleDirectionForKeyDown(
  current: ThrottleDirection,
  event: FlightKeyEvent,
): ThrottleDirection {
  if (event.metaKey || event.altKey) return current
  if (event.key === 'Shift') return 1
  if (event.key === 'Control') return -1
  return current
}

export function throttleDirectionForKeyUp(
  current: ThrottleDirection,
  event: FlightKeyEvent,
): ThrottleDirection {
  if (event.key === 'Shift' && current === 1) return 0
  if (event.key === 'Control' && current === -1) return 0
  return current
}
