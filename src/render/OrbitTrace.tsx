import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  Line as ThreeLine,
  Color,
} from 'three'
import type { Group } from 'three'
import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { useModeStore } from '../state/mode'
import { evaluateCurve } from '../sim/curves'

const MAX_POINTS = 1000

interface OrbitTraceProps {
  bodyId: string
}

/**
 * Draws a fading trail behind a body showing where it's been.
 * Older points fade to transparent. Points are parent-relative.
 */
export function OrbitTrace({ bodyId }: OrbitTraceProps) {
  const groupRef = useRef<Group>(null)
  const trailRef = useRef<[number, number, number][]>([])
  const [visible, setVisible] = useState(false)

  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const vehicle = useTrajectoriesStore((s) => s.vehicles[bodyId])
  const parentId = body?.parentId ?? vehicle?.parentId
  const color = body?.color ?? '#00ff88'

  const lineObj = useMemo(() => {
    const geom = new BufferGeometry()
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new Color(color) },
      },
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha);
        }
      `,
    })
    return new ThreeLine(geom, mat)
  }, [color])

  useFrame(() => {
    const group = groupRef.current
    if (!group || !parentId) return
    if (useModeStore.getState().activeView !== 'orbital') return

    const store = useTrajectoriesStore.getState()
    const { curves } = store
    const { followTargetId } = useCameraStore.getState()

    const bodyCurve = curves[bodyId]
    const parentCurve = curves[parentId]
    const targetCurve = curves[followTargetId]

    if (!bodyCurve || !parentCurve) return

    const t = store.getSimTime()

    const bodyPos = evaluateCurve(bodyCurve, t)
    const parentPos = evaluateCurve(parentCurve, t)

    // Record parent-relative position
    const trail = trailRef.current
    trail.push([
      bodyPos[0] - parentPos[0],
      bodyPos[1] - parentPos[1],
      bodyPos[2] - parentPos[2],
    ])
    if (trail.length > MAX_POINTS) {
      trail.splice(0, trail.length - MAX_POINTS)
    }

    // Position group at parent's camera-relative location
    let camX = 0, camY = 0, camZ = 0
    if (targetCurve) {
      const camPos = evaluateCurve(targetCurve, t)
      camX = camPos[0]; camY = camPos[1]; camZ = camPos[2]
    }
    group.position.set(
      parentPos[0] - camX,
      parentPos[1] - camY,
      parentPos[2] - camZ,
    )

    if (trail.length < 2) {
      setVisible(false)
      return
    }
    setVisible(true)

    const n = trail.length
    const positions = new Float32Array(n * 3)
    const alphas = new Float32Array(n)

    for (let i = 0; i < n; i++) {
      positions[i * 3] = trail[i][0]
      positions[i * 3 + 1] = trail[i][1]
      positions[i * 3 + 2] = trail[i][2]
      alphas[i] = (i / (n - 1)) * 0.5
    }

    const geom = lineObj.geometry as BufferGeometry
    geom.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geom.setAttribute('alpha', new Float32BufferAttribute(alphas, 1))
    geom.setDrawRange(0, n)
    geom.computeBoundingSphere()
  })

  if (!parentId) return null

  return (
    <group ref={groupRef} visible={visible}>
      <primitive object={lineObj} />
    </group>
  )
}
