import { Line } from '@react-three/drei'
import { rotationAxisPoints } from './rotation'

interface RotationLineProps {
  radius: number
}

export function RotationLine({ radius }: RotationLineProps) {
  return (
    <Line
      points={rotationAxisPoints(radius)}
      color="#f2f2f2"
      lineWidth={2}
      depthWrite={false}
    />
  )
}
