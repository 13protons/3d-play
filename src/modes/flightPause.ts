export function nextPauseMenuStateForEscape(paused: boolean): boolean {
  return !paused
}

export function shouldProcessFlightControlKey({
  paused,
  key,
}: {
  paused: boolean
  key: string
}): boolean {
  return !paused || key === 'Escape'
}
