import { describe, expect, it } from 'vitest'
import { partMeshUrl, usesBakedMesh } from '../partMesh'

describe('partMesh', () => {
  it('builds the public asset url for a mesh id', () => {
    expect(partMeshUrl('booster')).toBe('/models/parts/booster.glb')
  })

  it('uses a baked mesh only when meshId is a non-empty string', () => {
    expect(usesBakedMesh({ meshId: 'booster' })).toBe(true)
    expect(usesBakedMesh({})).toBe(false)
    expect(usesBakedMesh({ meshId: '' })).toBe(false)
  })
})
