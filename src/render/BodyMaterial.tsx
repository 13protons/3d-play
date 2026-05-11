import { useTexture } from '@react-three/drei'
import type { BodyMeta } from '../state/trajectories'

interface BodyMaterialProps {
  body: BodyMeta
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
  const map = useTexture(texture)

  return body.emissive ? (
    <meshBasicMaterial color={body.color} map={map} />
  ) : (
    <meshStandardMaterial
      color="#ffffff"
      emissive={body.color}
      emissiveIntensity={body.minimumLight}
      map={map}
    />
  )
}
