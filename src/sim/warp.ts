/** Available time warp rates. Shared between UI and input handling. */
export const WARP_RATES = [1, 5, 10, 50, 100, 1000, 10000, 100000] as const

export function nextWarpRate(current: number): number {
  const idx = WARP_RATES.indexOf(current as (typeof WARP_RATES)[number])
  if (idx === -1) return WARP_RATES[0]
  return WARP_RATES[Math.min(idx + 1, WARP_RATES.length - 1)]
}

export function prevWarpRate(current: number): number {
  const idx = WARP_RATES.indexOf(current as (typeof WARP_RATES)[number])
  if (idx === -1) return WARP_RATES[0]
  return WARP_RATES[Math.max(idx - 1, 0)]
}
