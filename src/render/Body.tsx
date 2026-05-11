import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Mesh, PointLight, Sprite } from 'three'
import { Vector3 } from 'three'
import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { useModeStore } from '../state/mode'
import { evaluateCurve } from '../sim/curves'
import { OrbitalMarker } from './OrbitalMarker'
import {
  projectedRadiusPx,
  shouldSuppressChildSprite,
  shouldUseBodySprite,
  spriteWorldSize,
} from './lod'

const MESH_THRESHOLD_PX = 6
const SPRITE_SIZE_PX = 12
const CHILD_COLLAPSE_THRESHOLD_PX = 18

interface BodyProps {
  bodyId: string
}

export function Body({ bodyId }: BodyProps) {
  const meshRef = useRef<Mesh>(null)
  const spriteRef = useRef<Sprite>(null)
  const lightRef = useRef<PointLight>(null)
  const camera = useThree((s) => s.camera)
  const viewport = useThree((s) => s.size)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'orbital') return
    if (!body) return
    const mesh = meshRef.current
    const sprite = spriteRef.current
    if (!mesh || !sprite) return

    const store = useTrajectoriesStore.getState()
    const { curves } = store
    const { followTargetId } = useCameraStore.getState()

    const t = store.getSimTime()

    const curve = curves[bodyId]
    const targetCurve = curves[followTargetId]

    if (!curve) return

    // Evaluate this body's absolute position
    const pos = evaluateCurve(curve, t)

    // Evaluate camera target's absolute position (floating origin)
    let camX = 0,
      camY = 0,
      camZ = 0
    if (targetCurve) {
      const camPos = evaluateCurve(targetCurve, t)
      camX = camPos[0]
      camY = camPos[1]
      camZ = camPos[2]
    }

    // Camera-relative position for float32 safety
    mesh.position.set(pos[0] - camX, pos[1] - camY, pos[2] - camZ)
    sprite.position.copy(mesh.position)

    const fov = 'fov' in camera ? (camera.fov * Math.PI) / 180 : Math.PI / 3
    const pixelsPerRadian = viewport.height / (2 * Math.tan(fov / 2))
    const distanceToCamera = mesh.position.distanceTo(camera.position)
    const radiusPx = projectedRadiusPx(body.radius, distanceToCamera, pixelsPerRadian)
    const useSprite = shouldUseBodySprite(radiusPx, MESH_THRESHOLD_PX)

    let suppressSprite = false
    if (useSprite && body.parentId) {
      const parentCurve = curves[body.parentId]
      if (parentCurve) {
        const parentPos = evaluateCurve(parentCurve, t)
        const parentScenePos = new Vector3(
          parentPos[0] - camX,
          parentPos[1] - camY,
          parentPos[2] - camZ,
        )
        const bodyScreen = mesh.position.clone().project(camera)
        const parentScreen = parentScenePos.project(camera)
        const screenSeparationPx = Math.hypot(
          (bodyScreen.x - parentScreen.x) * viewport.width * 0.5,
          (bodyScreen.y - parentScreen.y) * viewport.height * 0.5,
        )
        suppressSprite = shouldSuppressChildSprite(
          screenSeparationPx,
          CHILD_COLLAPSE_THRESHOLD_PX,
        )
      }
    }

    mesh.visible = !useSprite
    sprite.visible = useSprite && !suppressSprite
    const spriteSize = spriteWorldSize(
      SPRITE_SIZE_PX,
      distanceToCamera,
      pixelsPerRadian,
    )
    sprite.scale.set(spriteSize, spriteSize, 1)

    // Move point light with emissive bodies (Sun)
    if (lightRef.current) {
      lightRef.current.position.copy(mesh.position)
    }
  })

  if (!body) return null

  return (
    <group>
      <mesh ref={meshRef}>
        <sphereGeometry args={[body.radius, 32, 32]} />
        {body.emissive ? (
          <meshBasicMaterial color={body.color} />
        ) : (
          <meshStandardMaterial
            color={body.color}
            emissive={body.color}
            emissiveIntensity={body.minimumLight}
          />
        )}
      </mesh>
      <OrbitalMarker
        ref={spriteRef}
        color={body.color}
        shape="circle"
        bodyId={body.id}
      />
      {body.emissive && (
        <pointLight
          ref={lightRef}
          intensity={2}
          distance={0}
          decay={0}
        />
      )}
    </group>
  )
}
