import type { WebGLRenderer } from 'three'
import { PrecomputedTexturesGenerator } from '@takram/three-atmosphere'
import type { AtmosphereParameters, PrecomputedTextures } from '@takram/three-atmosphere'

/**
 * Per-body LUT cache. Baking the Bruneton tables (transmittance / scattering /
 * irradiance / multi-scatter) on the GPU is a one-time but non-trivial cost, so we
 * memoize the result textures by body id. A body's atmosphere params are static, so
 * the id is a sufficient key. The textures belong to the GL context that baked them;
 * this assumes the single, stable vehicle-canvas context (a remount would need a
 * cache clear — acceptable for now).
 */
const cacheByBody = new Map<string, Promise<PrecomputedTextures>>()

export function getAtmosphereTextures(
  gl: WebGLRenderer,
  bodyId: string,
  params: AtmosphereParameters,
): Promise<PrecomputedTextures> {
  const cached = cacheByBody.get(bodyId)
  if (cached) return cached
  const promise = bakeTextures(gl, params)
    .then((textures) => {
      console.info(`[atmosphere] LUTs baked for ${bodyId}`)
      return textures
    })
    .catch((error) => {
      // Don't cache a failure — let a later mount retry instead.
      cacheByBody.delete(bodyId)
      throw error
    })
  cacheByBody.set(bodyId, promise)
  return promise
}

async function bakeTextures(
  gl: WebGLRenderer,
  params: AtmosphereParameters,
): Promise<PrecomputedTextures> {
  if (!gl.getContext().getExtension('EXT_color_buffer_float')) {
    console.warn(
      '[atmosphere] EXT_color_buffer_float unavailable — float LUT bake may fail',
    )
  }
  // higherOrderScattering off trims the one-time bake cost (the multi-second startup
  // stall) for a small multi-scatter-accuracy loss that's invisible at our scale.
  const generator = new PrecomputedTexturesGenerator(gl, { higherOrderScattering: false })
  try {
    const textures = await generator.update(params)
    return textures
  } finally {
    // Free the scratch render targets; keep the result textures handed to the cache.
    generator.dispose({ textures: false })
  }
}
