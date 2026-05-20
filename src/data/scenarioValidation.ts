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

export interface ScenarioAssetValidation {
  bodyIds: string[]
  missingBodyDefinitions: string[]
  invalidBodyDefinitions: string[]
  invalidVehicles: string[]
  vehicleIdsWithAero: string[]
}

const scenarioModules = import.meta.glob<ScenarioAsset>(
  '../../public/data/scenarios/*.json',
  { eager: true, import: 'default' },
)

const bodyModules = import.meta.glob('../../public/data/bodies/*.json', {
  eager: true,
  import: 'default',
})

export function validateScenarioAssets(
  scenarioId: string,
): ScenarioAssetValidation {
  const scenarioPath = `../../public/data/scenarios/${scenarioId}.json`
  const scenario = scenarioModules[scenarioPath]
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`)

  const bodyIds = Object.keys(scenario.bodies)
  const missingBodyDefinitions = bodyIds.filter(
    (bodyId) => !bodyModules[`../../public/data/bodies/${bodyId}.json`],
  )
  const invalidBodyDefinitions = bodyIds.flatMap((bodyId) => {
    const body = bodyModules[`../../public/data/bodies/${bodyId}.json`]
    if (!body) return []
    try {
      validateBodyDefinition(body as Record<string, unknown>)
      return []
    } catch (error) {
      return [`${bodyId}: ${error instanceof Error ? error.message : String(error)}`]
    }
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

  return {
    bodyIds,
    missingBodyDefinitions,
    invalidBodyDefinitions,
    invalidVehicles,
    vehicleIdsWithAero,
  }
}

export function validateBodyDefinition(def: Record<string, unknown>): void {
  if (def.atmosphere === undefined) return
  validateAtmosphere(def.atmosphere)
}

export function validateVehicleDefinition(def: Record<string, unknown>): void {
  if (def.resources !== undefined) validateResources(def.resources)
  if (def.aero !== undefined) validateAero(def.aero)
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

function validateResources(value: unknown): asserts value is VehicleResources {
  const resources = objectValue(value, 'resources')
  numberGreaterThan(resources.dryMass, 0, 'resources.dryMass')
  numberAtLeast(resources.fuelMass, 0, 'resources.fuelMass')
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
