# Inline Atmosphere Drag Design

## Goal
Add a first playable atmosphere and drag pass without hardcoding Earth-specific behavior or splitting tiny atmosphere data into extra files too early.

## Scope
The first version defines an inline atmosphere model on Earth and applies simple vehicle drag when the active vehicle is close enough to its atmospheric parent. It proves the body-data shape, vehicle resource state, and an aerodynamic force-provider API while keeping the model intentionally small.

The stable architecture boundary is the force-provider API, not a dedicated web worker. The vehicle simulation calls the aerodynamic solver synchronously during integration with vehicle state, attitude, body atmosphere, and local environment inputs. The solver returns force and torque vectors. This avoids per-tick worker chatter and keeps aircraft-style dense-atmosphere flight compatible with substep force evaluation later.

## Body Data
Atmosphere is optional body metadata. A body without an `atmosphere` object has no atmosphere behavior. Earth is the only body that defines one in this pass.

```json
{
  "atmosphere": {
    "loadRadiusMultiplier": 1.25,
    "model": "exponential",
    "surfaceDensity": 1.225,
    "scaleHeight": 8500,
    "maxAltitude": 120000
  }
}
```

Small scalar simulation metadata stays inline in the body JSON. External resources are deferred until the data becomes large, layered, or renderer-specific, such as scattering tables, sky gradients, cloud textures, weather, terrain-coupled atmosphere, or tabular pressure and temperature profiles.

## Loading Boundary
`loadRadiusMultiplier` is the activation boundary for atmosphere metadata. For vehicle dynamics, Earth's first value is `1.25`, meaning the atmosphere model is active only while the vehicle is within `radius * 1.25` of the parent center.

`maxAltitude` remains the physical boundary for nonzero density. The bridge can activate the model at `1.25r` for cache and handoff simplicity, while the density function returns zero above `radius + maxAltitude`.

Visual atmosphere loading is intentionally not implemented. Later visual resources can use a separate, much larger threshold without changing the dynamics model.

Because this cupcake keeps the model inline, the initial body fetch already reads the atmosphere object with the rest of `earth.json`. The threshold controls simulation activation, not a separate network fetch. The bridge should still treat the threshold as the future resource-loading boundary so external atmosphere resources can be added later without changing gameplay behavior.

## Vehicle Aero Data
Atmosphere describes the body environment only. Vehicle mass and aerodynamic properties belong to the vehicle scenario data and runtime vehicle state. The first pass adds minimal optional vehicle `resources` and `aero` objects:

```json
{
  "resources": {
    "dryMass": 1000,
    "fuelMass": 0
  },
  "aero": {
    "model": "simple-drag",
    "dragCoefficient": 2.2,
    "referenceArea": 10,
    "referenceLength": 2,
    "centerOfPressureBody": [0, 0, 0]
  }
}
```

Runtime vehicle mass is `dryMass + fuelMass`. If a vehicle has no `resources` or no `aero` object, it experiences no atmospheric drag. This avoids hiding vehicle-specific constants in Earth metadata and gives fuel, staging, and later resources a clear store-owned path to affect dynamics.

`aero.model` is `simple-drag` for this cupcake. `referenceLength` and `centerOfPressureBody` are optional now but define the future geometry seam for torque, stability, Mach/Reynolds scaling, and part-derived aero without changing the message contract.

## Vehicle State Store
`src/state/vehicle.ts` becomes the main-thread vehicle resources store. For the cupcake it tracks each vehicle's `dryMass`, `fuelMass`, computed `mass`, and simple `aero` parameters. The bridge initializes it from scenario vehicle data. Runtime resource-change reporting is deferred until fuel consumption, staging, or part resources exist.

The vehicle worker consumes an initialization snapshot of resources and aero data for deterministic integration. Its aerodynamic force provider receives the same vehicle model data when solving forces. Later fuel burn, staging, part resources, battery charge, water, oxygen, temperature, or damage can update this store without moving mass ownership into atmosphere or body metadata.

## Data Flow
- `bridge.ts` reads optional `atmosphere` from body definitions while loading scenario bodies.
- `BodyMeta` may expose lightweight atmosphere presence or parameters if the UI or render layer needs them later.
- The bridge tracks each body's radius and optional atmosphere config alongside current surface metadata.
- The bridge initializes vehicle resources and aero state from scenario vehicle data.
- The bridge sends the vehicle worker the vehicle resources/aero snapshot and each body's surface/atmosphere metadata needed for local force solving.
- During each vehicle integration step, the vehicle worker samples the current parent body curve and calls the aerodynamic force provider with the current vehicle state, attitude, resources, aero data, parent surface motion, and parent atmosphere config.
- The force provider activates drag only when the vehicle has resources and `aero`, the parent has atmosphere, the parent distance is within `radius * loadRadiusMultiplier`, and altitude is at or below `maxAltitude`.
- If future parent handoff is added, the bridge will resend or update the active atmosphere config when the vehicle parent changes. Parent handoff is not part of this cupcake.

The first pass does not load any separate atmosphere files and does not introduce a general resource loader.

## Force Provider Boundary
The API boundary is force-oriented rather than integration-oriented:

- Vehicle worker owns vehicle state integration.
- The aerodynamic force provider owns atmosphere sampling, vehicle aerodynamic evaluation, and force/torque calculation.
- The vehicle worker calls the provider with vehicle state, attitude, vehicle aero/model data, body atmosphere metadata, and local body motion.
- The provider returns a force vector in world coordinates plus diagnostics. Torque is always `[0, 0, 0]` in this cupcake.
- The vehicle worker integrates returned forces with gravity, thrust, and surface contact.

The provider is an in-worker module for this cupcake. A dedicated worker can be introduced later for precomputed tables, batched many-vehicle force solving, or expensive atmosphere/geometry work, but cross-worker messaging is not part of the first drag implementation.

## Frames And Units
All simulation messages use SI units: meters, kilograms, seconds, newtons, newton-meters, radians, and radians per second.

World vectors are in the existing inertial simulation frame used by vehicle integration. Vehicle body vectors use the current control convention: `+Z` forward. Render meshes may need an adapter; aerodynamic data should not depend on mesh-local axes.

Vehicle orientation quaternions are treated as body-to-world rotations. The aerodynamic force provider uses that orientation to transform future body-frame forces, moments, and geometry into world coordinates.

Relative air velocity is defined as:

```text
parentAngularVelocityWorld = parentRotationAxisWorld * parentAngularVelocity
atmosphereVelocityWorld = parentVelocityWorld + cross(parentAngularVelocityWorld, vehiclePositionWorld - parentPositionWorld)
relativeAirVelocityWorld = vehicleVelocityWorld - atmosphereVelocityWorld
```

The relative-air vector points in the direction the vehicle is moving through the air. Drag force points opposite that vector. The first pass assumes zero wind, so atmosphere motion is only parent co-rotation.

Future torque convention:

```text
torqueBody = cross(centerOfPressureBody - centerOfMassBody, forceBody) + aerodynamicMomentBody
```

The cupcake returns zero torque, but the sign and frame convention are defined now so later torque work does not change the interface.

## API Shape
The first pass adds explicit TypeScript data shapes for the force provider. These are regular in-worker interfaces, not cross-worker messages.

Vehicle state input:

```ts
type AeroVehicleState = {
  vehicleId: string
  parentId: string
  simTime: number
  position: [number, number, number]
  velocity: [number, number, number]
  orientation: [number, number, number, number]
  angularVelocity: [number, number, number]
}
```

Force provider input:

```ts
type AeroForceInput = {
  vehicle: AeroVehicleState
  resources: { dryMass: number; fuelMass: number; mass: number }
  aero: {
    model: 'simple-drag'
    dragCoefficient: number
    referenceArea: number
    referenceLength?: number
    centerOfPressureBody?: [number, number, number]
  }
  parent: {
    id: string
    radius: number
    position: [number, number, number]
    velocity: [number, number, number]
    angularVelocity: number
    rotationAxisWorld: [number, number, number]
    atmosphere?: InlineAtmosphere
  }
}
```

Force provider output:

```ts
type AeroForceOutput = {
  forceWorld: [number, number, number]
  torqueWorld: [number, number, number]
  diagnostics: {
    density: number
    dynamicPressure: number
    altitude: number
    speed: number
    atmosphereVelocityWorld: [number, number, number]
    relativeAirVelocityWorld: [number, number, number]
    model: 'simple-drag' | 'none'
  }
}
```

Vehicle worker inbound `init` extends with:

```ts
resources?: { dryMass: number; fuelMass: number; mass: number }
aero?: {
  model: 'simple-drag'
  dragCoefficient: number
  referenceArea: number
  referenceLength?: number
  centerOfPressureBody?: [number, number, number]
}
```

The vehicle worker uses `resources.mass` to convert `forceWorld` to acceleration. If resources are absent, it skips aerodynamic force solving.

## Drag Model
The aerodynamic force provider produces a force vector. The vehicle worker divides that force by vehicle mass and applies the resulting acceleration after gravity and thrust.

```text
density = surfaceDensity * exp(-altitude / scaleHeight)
dynamicPressure = 0.5 * density * |relativeAirVelocityWorld|^2
forceWorld = -normalize(relativeAirVelocityWorld) * dynamicPressure * dragCoefficient * referenceArea
accelerationWorld = forceWorld / mass
```

The velocity used for drag is relative to the rotating atmosphere, not inertial space. The atmosphere is assumed to co-rotate with the parent body using the same axial tilt and angular velocity already used for surface contact.

The force helper must return zero force when density is zero, speed is near zero, vehicle aero data is missing, or atmosphere data is missing. It must not emit NaN or Infinity for any input.

The first pass uses vehicle store mass, not part-derived mass, because the current vehicle model does not yet have staged parts or fuel consumption. Part-based area, changing geometry, lift, aero torque, and heating are deferred.

## Error Handling
- Invalid atmosphere or vehicle `aero` objects fail scenario/body validation rather than silently producing undefined physics.
- Supported atmosphere `model` values: `exponential` only.
- Atmosphere numeric fields are SI units: `surfaceDensity` in kg/m^3, `scaleHeight`, `maxAltitude`, and parent `radius` in meters.
- Atmosphere fields are required when `atmosphere` is present: `loadRadiusMultiplier`, `model`, `surfaceDensity`, `scaleHeight`, and `maxAltitude`.
- Atmosphere numeric constraints: `loadRadiusMultiplier >= 1`, `surfaceDensity >= 0`, `scaleHeight > 0`, `maxAltitude >= 0`.
- Vehicle `resources` fields are required when `resources` is present: `dryMass` and `fuelMass`.
- Vehicle `resources` numeric constraints: `dryMass > 0`, `fuelMass >= 0`.
- Supported vehicle `aero.model` values: `simple-drag` only.
- Vehicle `aero` fields are required when `aero` is present: `model`, `dragCoefficient`, and `referenceArea`.
- Vehicle `aero` numeric constraints: `dragCoefficient >= 0`, `referenceArea >= 0`, optional `referenceLength > 0`.
- Optional `centerOfPressureBody` is a 3-number body-frame vector in meters.
- Unknown atmosphere, resources, and `aero` fields are allowed so future optional metadata does not break older scenarios.
- Unsupported atmosphere `model` values throw a clear load-time error.
- Missing atmosphere on a body means no drag.
- Missing `resources` on a vehicle means no drag.
- Missing `aero` on a vehicle means no drag.
- The force provider must fail safe to zero force for missing, inactive, invalid, or numerically unsafe inputs.
- Altitudes below zero are handled by existing surface-contact logic; the drag model should not try to solve collision behavior.

## Testing
- Validate body data accepts optional inline atmosphere and rejects malformed atmosphere fields.
- Unit-test exponential density at surface, scale height, max altitude, and above max altitude.
- Unit-test drag direction opposes atmospheric-relative velocity.
- Unit-test that bodies without atmosphere produce zero drag.
- Unit-test that vehicles without `resources` produce zero drag.
- Unit-test that vehicles without `aero` produce zero drag.
- Unit-test zero-speed and zero-density cases return finite zero force.
- Unit-test atmosphere co-rotation changes relative-air velocity as expected.
- Unit-test that atmosphere is inactive outside `radius * loadRadiusMultiplier` even if data exists.
- Unit-test vehicle resource mass calculation in the vehicle state store.
- Add a vehicle-worker integration test proving a low Earth vehicle loses orbital energy when aerodynamic forces are active.
- Unit-test the aerodynamic force provider independently from the vehicle integrator.

## Deferred
- External atmosphere resource files.
- Visual atmosphere rendering and separate visual load thresholds.
- Atmosphere data for Venus, Mars, gas giants, or moons.
- Orbital worker drag on celestial bodies.
- Dedicated atmosphere/aero worker and cross-worker force requests.
- Full publish/subscribe message bus abstraction.
- Cube-patch atmosphere fields.
- Pressure, temperature, speed of sound, lift, heating, aero torque, and weather.
- Fuel consumption, staging, and part-derived drag surfaces.
