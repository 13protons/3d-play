interface ScenarioAsset {
  bodies: Record<string, unknown>
  vehicles?: unknown[]
}

export interface InlineAtmosphere {
  loadRadiusMultiplier: number
  model: 'exponential'
  surfaceDensity: number
  scaleHeight: number
  maxAltitude: number
}

export interface VehicleResources {
  dryMass: number
  fuelMass: number
}

export interface VehicleAero {
  model: 'simple-drag'
  dragCoefficient: number
  referenceArea: number
  referenceLength?: number
  centerOfPressureBody?: [number, number, number]
}

export interface VehicleEngine {
  maxThrust: number
  isp: number
}

export interface VehicleAttitude {
  momentOfInertia: [number, number, number]
  reactionWheelTorque: [number, number, number]
}

export interface ScenarioAssetValidation {
  bodyIds: string[]
  missingBodyDefinitions: string[]
  invalidBodyDefinitions: string[]
  invalidVehicles: string[]
  vehicleIdsWithAero: string[]
  vehicleIdsWithEngine: string[]
  vehicleIdsWithAttitude: string[]
}

const scenarioModules = import.meta.glob<ScenarioAsset>(
  '../../public/data/scenarios/*.json',
  { eager: true, import: 'default' },
)

// Each body is a plugin bundle: `bodies/<id>/manifest.json`. This eager glob is
// a test/validation helper only (validateScenarioAssets is never imported by
// the app), so bundling every manifest here doesn't affect the runtime — the
// app fetches only a scenario's referenced bodies over the network.
const manifestBodyModules = import.meta.glob('../../public/data/bodies/*/manifest.json', {
  eager: true,
  import: 'default',
})

const bodyDefById: Record<string, unknown> = {}
for (const [path, def] of Object.entries(manifestBodyModules)) {
  const id = path.split('/').slice(-2, -1)[0]
  if (id) bodyDefById[id] = def
}

// A body's atmosphere lives in a sibling asset (`bodies/<id>/atmosphere.json`)
// with `render` (takram scattering) + `physics` (exponential drag) sections —
// not inline in the manifest. Same test/validation-only eager glob caveat as above.
const atmosphereAssetModules = import.meta.glob('../../public/data/bodies/*/atmosphere.json', {
  eager: true,
  import: 'default',
})

const atmosphereAssetById: Record<string, unknown> = {}
for (const [path, asset] of Object.entries(atmosphereAssetModules)) {
  const id = path.split('/').slice(-2, -1)[0]
  if (id) atmosphereAssetById[id] = asset
}

export function validateScenarioAssets(
  scenarioId: string,
): ScenarioAssetValidation {
  const scenarioPath = `../../public/data/scenarios/${scenarioId}.json`
  const scenario = scenarioModules[scenarioPath]
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`)

  const bodyIds = Object.keys(scenario.bodies)
  const missingBodyDefinitions = bodyIds.filter(
    (bodyId) => !bodyDefById[bodyId],
  )
  const invalidBodyDefinitions = bodyIds.flatMap((bodyId) => {
    const body = bodyDefById[bodyId]
    if (!body) return []
    const errors: string[] = []
    const fail = (error: unknown) =>
      errors.push(`${bodyId}: ${error instanceof Error ? error.message : String(error)}`)
    try {
      validateBodyDefinition(body as Record<string, unknown>)
    } catch (error) {
      fail(error)
    }
    // A body that links an atmosphere asset must have a valid one (sim-critical drag).
    const render = (body as Record<string, unknown>).render as Record<string, unknown> | undefined
    if (typeof render?.atmosphere === 'string') {
      const asset = atmosphereAssetById[bodyId]
      if (!asset) {
        fail(new Error(`atmosphere asset missing: ${render.atmosphere}`))
      } else {
        try {
          validateAtmosphereAsset(asset as Record<string, unknown>)
        } catch (error) {
          fail(error)
        }
      }
    }
    return errors
  })
  const invalidVehicles = (scenario.vehicles ?? []).flatMap((vehicle, index) => {
    try {
      validateVehicleDefinition(vehicle as Record<string, unknown>)
      return []
    } catch (error) {
      const vehicleId = objectValue(vehicle, 'vehicle').id ?? index
      return [`${vehicleId}: ${error instanceof Error ? error.message : String(error)}`]
    }
  })
  const vehicleIdsWithAero = (scenario.vehicles ?? [])
    .filter((vehicle) => {
      const def = vehicle as Record<string, unknown>
      return def.resources !== undefined && def.aero !== undefined
    })
    .map((vehicle) => String((vehicle as Record<string, unknown>).id))
  const vehicleIdsWithEngine = vehicleIdsWith(scenario, 'engine')
  const vehicleIdsWithAttitude = vehicleIdsWith(scenario, 'attitude')

  return {
    bodyIds,
    missingBodyDefinitions,
    invalidBodyDefinitions,
    invalidVehicles,
    vehicleIdsWithAero,
    vehicleIdsWithEngine,
    vehicleIdsWithAttitude,
  }
}

function vehicleIdsWith(scenario: ScenarioAsset, property: string): string[] {
  return (scenario.vehicles ?? [])
    .filter((vehicle) => (vehicle as Record<string, unknown>)[property] !== undefined)
    .map((vehicle) => String((vehicle as Record<string, unknown>).id))
}

export function validateBodyDefinition(def: Record<string, unknown>): void {
  if (def.atmosphere === undefined) return
  validateAtmosphere(def.atmosphere)
}

export function validateVehicleDefinition(def: Record<string, unknown>): void {
  if (def.resources !== undefined) validateResources(def.resources)
  if (def.engine !== undefined) validateEngine(def.engine)
  if (def.attitude !== undefined) validateAttitude(def.attitude)
  if (def.aero !== undefined) validateAero(def.aero)
}

/**
 * Validate a body's atmosphere asset (`bodies/<id>/atmosphere.json`): the
 * `physics` section (exponential drag model) and/or the `render` section (takram
 * scattering params). Each is validated only if present.
 */
export function validateAtmosphereAsset(asset: Record<string, unknown>): void {
  if (asset.physics !== undefined) validateAtmosphere(asset.physics)
  if (asset.render !== undefined) validateRenderConfig(asset.render)
}

function validateAtmosphere(value: unknown): asserts value is InlineAtmosphere {
  const atmosphere = objectValue(value, 'atmosphere')
  if (atmosphere.model !== 'exponential') {
    throw new Error('atmosphere.model must be exponential')
  }
  numberAtLeast(atmosphere.loadRadiusMultiplier, 1, 'atmosphere.loadRadiusMultiplier')
  numberAtLeast(atmosphere.surfaceDensity, 0, 'atmosphere.surfaceDensity')
  numberGreaterThan(atmosphere.scaleHeight, 0, 'atmosphere.scaleHeight')
  numberAtLeast(atmosphere.maxAltitude, 0, 'atmosphere.maxAltitude')
}

function validateRenderConfig(value: unknown): void {
  const render = objectValue(value, 'render')
  numberGreaterThan(render.shellHeight, 0, 'render.shellHeight')
  const rayleigh = render.rayleighScattering
  if (
    !Array.isArray(rayleigh) || rayleigh.length !== 3 ||
    rayleigh.some((v) => typeof v !== 'number' || !Number.isFinite(v) || v < 0)
  ) {
    throw new Error('render.rayleighScattering must be a 3-number vector >= 0')
  }
  numberGreaterThan(render.rayleighScaleHeight, 0, 'render.rayleighScaleHeight')
  numberAtLeast(render.mieScattering, 0, 'render.mieScattering')
  numberGreaterThan(render.mieScaleHeight, 0, 'render.mieScaleHeight')
  if (
    typeof render.miePhaseFunctionG !== 'number' ||
    render.miePhaseFunctionG < 0 || render.miePhaseFunctionG >= 1
  ) {
    throw new Error('render.miePhaseFunctionG must be in [0, 1)')
  }
}

function validateResources(value: unknown): asserts value is VehicleResources {
  const resources = objectValue(value, 'resources')
  numberGreaterThan(resources.dryMass, 0, 'resources.dryMass')
  numberAtLeast(resources.fuelMass, 0, 'resources.fuelMass')
}

function validateEngine(value: unknown): asserts value is VehicleEngine {
  const engine = objectValue(value, 'engine')
  numberGreaterThan(engine.maxThrust, 0, 'engine.maxThrust')
  numberGreaterThan(engine.isp, 0, 'engine.isp')
}

function validateAttitude(value: unknown): asserts value is VehicleAttitude {
  const attitude = objectValue(value, 'attitude')
  positiveVector(attitude.momentOfInertia, 'attitude.momentOfInertia')
  positiveVector(attitude.reactionWheelTorque, 'attitude.reactionWheelTorque')
}

function validateAero(value: unknown): asserts value is VehicleAero {
  const aero = objectValue(value, 'aero')
  if (aero.model !== 'simple-drag') throw new Error('aero.model must be simple-drag')
  numberAtLeast(aero.dragCoefficient, 0, 'aero.dragCoefficient')
  numberAtLeast(aero.referenceArea, 0, 'aero.referenceArea')
  if (aero.referenceLength !== undefined) {
    numberGreaterThan(aero.referenceLength, 0, 'aero.referenceLength')
  }
  if (aero.centerOfPressureBody !== undefined) {
    const center = aero.centerOfPressureBody
    if (!Array.isArray(center) || center.length !== 3 || center.some((v) => typeof v !== 'number')) {
      throw new Error('aero.centerOfPressureBody must be a 3-number vector')
    }
  }
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function positiveVector(value: unknown, name: string): asserts value is [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${name} must be a 3-number vector`)
  }
  for (const component of value) {
    numberGreaterThan(component, 0, name)
  }
}

function numberAtLeast(value: unknown, min: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`${name} must be >= ${min}`)
  }
}

function numberGreaterThan(value: unknown, min: number, name: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= min) {
    throw new Error(`${name} must be > ${min}`)
  }
}
