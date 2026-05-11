import { describe, expect, it } from 'vitest'
import { validateBodyTextureAssets } from '../bodyTextureAssets'

describe('validateBodyTextureAssets', () => {
  it('accepts declared body texture assets', () => {
    expect(validateBodyTextureAssets()).toEqual({ missingTextures: [] })
  })
})
