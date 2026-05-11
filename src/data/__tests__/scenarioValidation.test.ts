import { describe, expect, it } from 'vitest'
import { validateScenarioAssets } from '../scenarioValidation'

describe('validateScenarioAssets', () => {
  it('accepts the inner solar system scenario and body definitions', () => {
    const result = validateScenarioAssets('inner-solar-system')

    expect(result.missingBodyDefinitions).toEqual([])
    expect(result.bodyIds).toEqual([
      'sun',
      'mercury',
      'venus',
      'earth',
      'moon',
      'mars',
      'phobos',
      'deimos',
    ])
  })

  it('accepts the full solar system scenario and body definitions', () => {
    const result = validateScenarioAssets('full-solar-system')

    expect(result.missingBodyDefinitions).toEqual([])
    expect(result.bodyIds).toEqual([
      'sun',
      'mercury',
      'venus',
      'earth',
      'moon',
      'mars',
      'phobos',
      'deimos',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
    ])
  })
})
