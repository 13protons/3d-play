import { Line } from '@react-three/drei'
import { craftDebugAeroForceSegment, craftDebugAxisSegments } from './rotation'

interface CraftDebugAxesProps {
  length: number
  aeroForceWorld?: [number, number, number]
  orientation?: [number, number, number, number]
}

export function CraftDebugAxes({ length, aeroForceWorld, orientation }: CraftDebugAxesProps) {
  const axes = craftDebugAxisSegments(length)
  const aeroForce = craftDebugAeroForceSegment(aeroForceWorld, orientation)

  return (
    <group>
      <Line points={axes.x} color="#ff6b6b" lineWidth={2} depthWrite={false} depthTest={false} />
      <Line points={axes.y} color="#7dff7a" lineWidth={2} depthWrite={false} depthTest={false} />
      <Line points={axes.z} color="#5ecbff" lineWidth={2} depthWrite={false} depthTest={false} />
      <Line points={axes.thrust} color="#ffffff" lineWidth={3} depthWrite={false} depthTest={false} />
      <mesh position={axes.cot}>
        <sphereGeometry args={[0.16, 12, 8]} />
        <meshBasicMaterial color="#ff8a18" depthTest={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.12, 12, 8]} />
        <meshBasicMaterial color="#ffffff" depthTest={false} />
      </mesh>
      {aeroForce && <Line points={aeroForce} color="#ff4df8" lineWidth={4} depthWrite={false} depthTest={false} />}
    </group>
  )
}
