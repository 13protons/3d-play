/**
 * Rocket-equation helpers: propellant flow, fuel-limited throttle, and burn
 * budgets. Pure functions (no state) so they're shared by the vehicle worker
 * (per-step fuel burn) and the UI (maneuver-node ΔV / burn time).
 */

/** Standard gravity used to convert specific impulse (s) ↔ exhaust velocity. */
export const STANDARD_GRAVITY = 9.80665 // m/s²

/** Exhaust velocity (m/s) for a given specific impulse (s). */
export function exhaustVelocity(isp: number): number {
  return isp > 0 ? isp * STANDARD_GRAVITY : 0
}

/** Propellant mass flow (kg/s) at the given throttle: ṁ = F·throttle / (Isp·g₀). */
export function massFlowRate(maxThrust: number, isp: number, throttle: number): number {
  const ve = exhaustVelocity(isp)
  if (ve <= 0 || maxThrust <= 0 || throttle <= 0) return 0
  return (throttle * maxThrust) / ve
}

export interface FuelBurnStep {
  maxThrust: number
  isp: number
  throttle: number
  fuelMass: number
  elapsedSeconds: number
}

/**
 * Throttle the engine can actually sustain over a step. Equals the commanded
 * throttle while there's enough propellant; scaled down (so average thrust
 * matches the fuel available) on the step that empties the tank; zero when dry.
 */
export function fuelLimitedThrottle({ maxThrust, isp, throttle, fuelMass, elapsedSeconds }: FuelBurnStep): number {
  if (throttle <= 0 || fuelMass <= 0 || elapsedSeconds <= 0) return 0
  const requested = massFlowRate(maxThrust, isp, throttle) * elapsedSeconds
  if (requested <= 0) return 0
  return requested <= fuelMass ? throttle : throttle * (fuelMass / requested)
}

/** Propellant burned (kg) over a step at the given throttle, clamped to remaining. */
export function fuelBurned({ maxThrust, isp, throttle, fuelMass, elapsedSeconds }: FuelBurnStep): number {
  if (elapsedSeconds <= 0) return 0
  const burn = massFlowRate(maxThrust, isp, throttle) * elapsedSeconds
  return Math.min(Math.max(burn, 0), Math.max(fuelMass, 0))
}

/** Tsiolkovsky ΔV (m/s) available from burning down to `dryMass`. */
export function deltaVBudget(wetMass: number, dryMass: number, isp: number): number {
  const ve = exhaustVelocity(isp)
  if (ve <= 0 || dryMass <= 0 || wetMass <= dryMass) return 0
  return ve * Math.log(wetMass / dryMass)
}

/**
 * Time (s) to produce `deltaV` at full thrust, accounting for the mass lost as
 * propellant burns (so it's longer than the naive impulsive m·ΔV/F). Returns
 * Infinity if the engine can't deliver the requested ΔV from the fuel on board.
 */
export function burnTimeForDeltaV(deltaV: number, maxThrust: number, isp: number, wetMass: number): number {
  if (deltaV <= 0) return 0
  const ve = exhaustVelocity(isp)
  if (ve <= 0 || maxThrust <= 0 || wetMass <= 0) return Infinity
  const finalMass = wetMass * Math.exp(-deltaV / ve)
  return ((wetMass - finalMass) * ve) / maxThrust
}
