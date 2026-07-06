import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { Group, Mesh, PointLight, Sprite } from 'three'
import { Vector3 } from 'three'
import { useTrajectoriesStore } from '../state/trajectories'
import { useCameraStore } from '../state/camera'
import { useModeStore } from '../state/mode'
import { evaluateCurve } from '../sim/curves'
import { OrbitalMarker } from './OrbitalMarker'
import { RotationLine } from './RotationLine'
import { AtmosphereGlowMaterial, BodyMaterial } from './BodyMaterial'
import {
  bodySurfaceOrientationEuler,
  rotatingBodyTransform,
  shouldShowBodyRotationAxisInView,
} from './rotation'
import {
  projectedRadiusPx,
  shouldSuppressChildSprite,
  shouldUseBodySprite,
  spriteWorldSize,
} from './lod'
import { orbitalPlanetSurfaceRenderDecision } from './terrain/terrainLodPolicy'
import { createBodySurfaceGeometry } from './bodySurfaceGeometry'

const MESH_THRESHOLD_PX = 6
const SPRITE_SIZE_PX = 12
const CHILD_COLLAPSE_THRESHOLD_PX = 18
// Emissive (sun) glow sprite. When the Sun's disc drops below MESH_THRESHOLD_PX
// it swaps to a sprite that must still read as the sky's brightest object. The
// glow halo is BAKED into the sprite texture (see OrbitalMarker) and drawn
// large, and the gain keeps the core's bloom luminance BELOW the 2.0 threshold
// — the sun takes no part in bloom at all. Bloom of a sub-resolution splat is
// what made the sun flicker: the thresholded energy modulates with subpixel
// phase, so the halo pulsed whenever the sun drifted on screen. The gain still
// saturates the core to a hot white centre after tone mapping.
const EMISSIVE_SPRITE_SIZE_PX = 56
const EMISSIVE_SPRITE_HDR_GAIN = 2

interface BodyProps {
  bodyId: string
}

export function Body({ bodyId }: BodyProps) {
  const spinGroupRef = useRef<Group>(null)
  const meshRef = useRef<Mesh>(null)
  const spriteRef = useRef<Sprite>(null)
  const lightRef = useRef<PointLight>(null)
  const atmosphereRef = useRef<Mesh>(null)
  const camera = useThree((s) => s.camera)
  const viewport = useThree((s) => s.size)
  const body = useTrajectoriesStore((s) => s.bodies[bodyId])
  const showRotationAxes = useModeStore((s) => s.showRotationAxes)
  const radius = body?.radius
  const surfaceGeometry = useMemo(
    () => radius != null ? createBodySurfaceGeometry(radius) : undefined,
    [radius],
  )

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'orbital') return
    if (!body) return
    const mesh = meshRef.current
    const sprite = spriteRef.current
    const spinGroup = spinGroupRef.current
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

    // Camera-relative position for float32 safety. The body mesh stays local to
    // the rotating group so spin/tilt cannot rotate its orbital placement.
    const scenePosition: [number, number, number] = [
      pos[0] - camX,
      pos[1] - camY,
      pos[2] - camZ,
    ]
    const transform = rotatingBodyTransform(scenePosition)
    if (spinGroup) {
      spinGroup.position.set(...transform.groupPosition)
    }
    mesh.position.set(...transform.meshPosition)
    sprite.position.set(...scenePosition)

    const fov = 'fov' in camera ? (camera.fov * Math.PI) / 180 : Math.PI / 3
    const pixelsPerRadian = viewport.height / (2 * Math.tan(fov / 2))
    const scenePositionVector = new Vector3(...scenePosition)
    const distanceToCamera = scenePositionVector.distanceTo(camera.position)
    const radiusPx = projectedRadiusPx(body.radius, distanceToCamera, pixelsPerRadian)
    const useSprite = shouldUseBodySprite(radiusPx, MESH_THRESHOLD_PX)
    const surfaceDecision = orbitalPlanetSurfaceRenderDecision({
      bodyRadius: body.radius,
      cameraDistance: distanceToCamera,
      fovRadians: fov,
      viewportHeight: viewport.height,
    })

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
        const bodyScreen = scenePositionVector.clone().project(camera)
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

    mesh.visible = !useSprite && surfaceDecision.showFallbackSphere
    sprite.visible = useSprite && !suppressSprite
    // The atmosphere halo rides with the body (unrotated) and shows whenever the
    // planet is a 3D body — both base-sphere and terrain-tile ranges, not just when
    // the fallback sphere is visible.
    if (atmosphereRef.current) {
      atmosphereRef.current.position.set(...scenePosition)
      atmosphereRef.current.visible = !useSprite
    }
    if (spinGroup) {
      spinGroup.visible = mesh.visible
      spinGroup.rotation.set(
        ...bodySurfaceOrientationEuler({
          rotationPhase: body.rotationPhase,
          angularVelocity: body.angularVelocity,
          simTime: t,
          axialTilt: body.axialTilt,
        }),
      )
    }
    const spriteSize = spriteWorldSize(
      body.emissive ? EMISSIVE_SPRITE_SIZE_PX : SPRITE_SIZE_PX,
      distanceToCamera,
      pixelsPerRadian,
    )
    sprite.scale.set(spriteSize, spriteSize, 1)

    // Move point light with emissive bodies (Sun)
    if (lightRef.current) {
      lightRef.current.position.set(...scenePosition)
    }
  })

  if (!body) return null

  return (
    <group>
      <group ref={spinGroupRef}>
        <mesh ref={meshRef} geometry={surfaceGeometry}>
          <BodyMaterial body={body} />
        </mesh>
        {shouldShowBodyRotationAxisInView('orbital', showRotationAxes) && (
          <RotationLine radius={body.radius} />
        )}
      </group>
      {body.atmosphereRender && (
        <mesh ref={atmosphereRef}>
          <sphereGeometry args={[body.radius + body.atmosphereRender.shellHeight, 64, 32]} />
          <AtmosphereGlowMaterial body={body} />
        </mesh>
      )}
      <OrbitalMarker
        ref={spriteRef}
        color={body.color}
        shape="circle"
        bodyId={body.id}
        hdrBoost={body.emissive ? EMISSIVE_SPRITE_HDR_GAIN : undefined}
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
