import { WebGPULine } from './WebGPULine'
import { rotationAxisPoints } from './rotation'

interface RotationLineProps {
  radius: number
}

export function RotationLine({ radius }: RotationLineProps) {
  return (
    <WebGPULine
      points={rotationAxisPoints(radius)}
      color="#f2f2f2"
      lineWidth={2}
      depthWrite={false}
    />
  )
}
