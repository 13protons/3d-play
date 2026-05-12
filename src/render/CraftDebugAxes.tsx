import { Line } from '@react-three/drei'
import { craftDebugAxisSegments } from './rotation'

interface CraftDebugAxesProps {
  length: number
}

export function CraftDebugAxes({ length }: CraftDebugAxesProps) {
  const axes = craftDebugAxisSegments(length)

  return (
    <group>
      <Line points={axes.x} color="#ff6b6b" lineWidth={2} depthWrite={false} />
      <Line points={axes.y} color="#7dff7a" lineWidth={2} depthWrite={false} />
      <Line points={axes.z} color="#5ecbff" lineWidth={2} depthWrite={false} />
      <Line points={axes.thrust} color="#ffffff" lineWidth={3} depthWrite={false} />
      <mesh position={axes.cot}>
        <sphereGeometry args={[0.16, 12, 8]} />
        <meshBasicMaterial color="#ff8a18" />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  )
}
