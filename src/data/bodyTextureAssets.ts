interface BodyAsset {
  render?: {
    texture?: string
  }
}

export interface BodyTextureAssetValidation {
  missingTextures: string[]
}

const bodyModules = import.meta.glob<BodyAsset>(
  '../../public/data/bodies/*.json',
  { eager: true, import: 'default' },
)

const textureModules = import.meta.glob('../../public/data/textures/*', {
  eager: true,
  import: 'default',
})

export function validateBodyTextureAssets(): BodyTextureAssetValidation {
  const missingTextures = Object.values(bodyModules)
    .map((body) => body.render?.texture)
    .filter((texture): texture is string => Boolean(texture))
    .filter((texture) => !textureModules[`../../public${texture}`])

  return { missingTextures }
}
