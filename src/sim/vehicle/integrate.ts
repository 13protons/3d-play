import { evaluateGravity } from '../cube-patch'

export interface VehicleState {
  position: [number, number, number]
  velocity: [number, number, number]
}

/** Module-level scratch array for zero-allocation gravity evaluation. */
const _g: [number, number, number] = [0, 0, 0]

/**
 * Störmer-Verlet integration for a single vehicle using cube patch gravity.
 * Mutates state in place.
 */
export function integrateVehicle(
  state: VehicleState,
  patch: Float64Array,
  dt: number,
): void {
  const halfDt = dt * 0.5

  // Step 1: half-velocity update
  evaluateGravity(patch, state.position[0], state.position[1], state.position[2], _g)
  state.velocity[0] += _g[0] * halfDt
  state.velocity[1] += _g[1] * halfDt
  state.velocity[2] += _g[2] * halfDt

  // Step 2: full-position update
  state.position[0] += state.velocity[0] * dt
  state.position[1] += state.velocity[1] * dt
  state.position[2] += state.velocity[2] * dt

  // Step 3: second half-velocity update
  evaluateGravity(patch, state.position[0], state.position[1], state.position[2], _g)
  state.velocity[0] += _g[0] * halfDt
  state.velocity[1] += _g[1] * halfDt
  state.velocity[2] += _g[2] * halfDt
}
