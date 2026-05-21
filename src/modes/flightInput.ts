export type ThrottleDirection = -1 | 0 | 1

export interface FlightKeyEvent {
  key: string
  metaKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
}

export type ThrottlePreset = 'full' | 'cut'

export function throttleDirectionForKeyDown(
  current: ThrottleDirection,
  event: FlightKeyEvent,
): ThrottleDirection {
  if (event.metaKey || event.altKey) return current
  if (event.ctrlKey) return current
  if (event.key === 'z' || event.key === 'Z') return 1
  if (event.key === 'x' || event.key === 'X') return -1
  return current
}

export function throttleDirectionForKeyUp(
  current: ThrottleDirection,
  event: FlightKeyEvent,
): ThrottleDirection {
  if ((event.key === 'z' || event.key === 'Z') && current === 1) return 0
  if ((event.key === 'x' || event.key === 'X') && current === -1) return 0
  return current
}

export function throttlePresetForKeyDown(event: FlightKeyEvent): ThrottlePreset | null {
  if (event.metaKey || event.altKey || !event.ctrlKey) return null
  if (event.key === 'z' || event.key === 'Z') return 'full'
  if (event.key === 'x' || event.key === 'X') return 'cut'
  return null
}
