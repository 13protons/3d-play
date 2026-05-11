interface ScenarioAsset {
  bodies: Record<string, unknown>
}

export interface ScenarioAssetValidation {
  bodyIds: string[]
  missingBodyDefinitions: string[]
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

  return { bodyIds, missingBodyDefinitions }
}
