import { useTexture } from '@react-three/drei'
import { RepeatWrapping } from 'three'
import type { Texture } from 'three'
import type { BodyMeta } from '../state/trajectories'

interface BodyMaterialProps {
  body: BodyMeta
}

// Surface textures are equirectangular: U wraps the globe in longitude, so it must
// repeat (seam tiles carry UVs that run past 1 — see generatedTileSource). V is
// latitude and stays clamped at the poles. Set on load so we don't mutate the
// shared cached texture during render.
function configureSurfaceTextureWrap(loaded: Texture | Texture[]): void {
  for (const texture of Array.isArray(loaded) ? loaded : [loaded]) {
    texture.wrapS = RepeatWrapping
    texture.needsUpdate = true
  }
}

export function BodyMaterial({ body }: BodyMaterialProps) {
  if (body.texture) {
    return <TexturedBodyMaterial body={body} texture={body.texture} />
  }

  return body.emissive ? (
    <meshBasicMaterial color={body.color} />
  ) : (
    <meshStandardMaterial
      color={body.color}
      emissive={body.color}
      emissiveIntensity={body.minimumLight}
    />
  )
}

function TexturedBodyMaterial({
  body,
  texture,
}: BodyMaterialProps & { texture: string }) {
  const map = useTexture(texture, configureSurfaceTextureWrap)

  return body.emissive ? (
    <meshBasicMaterial color={body.color} map={map} />
  ) : (
    <meshStandardMaterial
      color="#ffffff"
      emissive="#ffffff"
      emissiveIntensity={body.minimumLight}
      emissiveMap={map}
      map={map}
    />
  )
}
