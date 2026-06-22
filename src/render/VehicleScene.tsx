import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import type { AmbientLight, DirectionalLight, Group, Mesh, MeshBasicMaterial, Object3D } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useModeStore } from '../state/mode';
import { useTrajectoriesStore } from '../state/trajectories';
import { useVehicleStore } from '../state/vehicle';
import { Vessel } from './Vessel';
import { allFinite } from './finite';
import type { BodyMeta } from '../state/trajectories';
import { evaluateCurve } from '../sim/curves';
import { evaluateCurveVelocity } from '../sim/curves';
import { computeFlightReferenceFrame, rotationAxisFromAxialTilt, surfaceFrame } from '../sim/vehicle/referenceFrame';
import {
  isSunOccluded,
  projectDistantSphere,
  type SunOccluder,
  type Vec3,
  vehicleSceneSunLightIntensity,
  vehicleSceneSunLightPosition,
} from './lighting';
import { BodyMaterial } from './BodyMaterial';
import { CraftDebugAxes } from './CraftDebugAxes';
import { cameraUpLerpAlpha, surfaceCameraPosition } from './cameraSmoothing';
import {
  SURFACE_CAMERA_MIN_HEIGHT,
  shouldHideBodySphereForLocalSurface,
} from './surfacePatch';
import { clampOutsideSphere } from './cameraClamp';
import { bodySurfaceOrientationEuler, vehicleBodyTransform } from './rotation';
import { RENDER_LAYERS } from './renderLayers';
import { PlanetTerrainTiles } from './terrain/PlanetTerrainTiles';
import { vehiclePlanetSurfaceRenderDecision } from './terrain/terrainLodPolicy';
import { createBodySurfaceGeometry } from './bodySurfaceGeometry';
import { PerfLogger } from './PerfLogger';
import { countRender } from './perfCounters';
import { VehicleSky } from './sky/VehicleSky';
import { RenderPipeline } from './RenderPipeline';
import { makeWebGPURenderer } from './webgpuRenderer';

const SUN_RENDER_DISTANCE = 5e8;

// How far the vehicle camera may orbit out from the craft, as a multiple of the
// parent body's radius. Tiny bodies cap on radius; larger ones hit the absolute
// distance cap below first. Surveying the whole system is the orbital map's job (V key).
// Falls back when there's no parent body.
const VEHICLE_VIEW_MAX_RADII = 0.4;
const VEHICLE_VIEW_MAX_DISTANCE_FALLBACK = 2e7;

// Absolute zoom-out cap, scene units == metres: keep the camera within 10 km of the craft so the
// sky-dome illusion holds — beyond this the planet starts reading as a ball and the camera-locked
// sky stops being convincing. Anything wider is the orbital map's job.
const VEHICLE_VIEW_MAX_DISTANCE = 10_000;

// Closest the vehicle camera may zoom to the craft. Small so it can tuck in low and
// beside the rocket to angle up toward the sky — the surface sphere clamp still stops
// it at the ground, so it can't break the ground plane. (Orbit-around-the-craft can't
// fully reach the zenith; this just gets as close as the geometry allows.)
const VEHICLE_VIEW_MIN_DISTANCE = 2.5;

/**
 * Walk up from vehicleParentId to root, collecting ancestors and their direct children.
 * Example: vehicle parentId='earth' -> returns ['earth', 'sun', 'moon']
 */
function getCelestialHierarchy(bodies: Record<string, BodyMeta>, vehicleParentId: string): string[] {
  const result = new Set<string>();
  const allBodies = Object.values(bodies);

  // Walk up from vehicleParentId to root, collecting ancestors
  let currentId: string | null = vehicleParentId;
  const ancestors: string[] = [];
  while (currentId) {
    ancestors.push(currentId);
    result.add(currentId);
    const body: BodyMeta | undefined = bodies[currentId];
    currentId = body?.parentId ?? null;
  }

  // Add all direct children of each ancestor
  for (const ancestorId of ancestors) {
    for (const body of allBodies) {
      if (body.parentId === ancestorId) {
        result.add(body.id);
      }
    }
  }

  return Array.from(result);
}

function VehicleBody({
  bodyId,
  vehicleId,
  visibleBodyIds,
}: {
  bodyId: string;
  vehicleId: string;
  visibleBodyIds: string[];
}) {
  const spinGroupRef = useRef<Group>(null);
  const meshRef = useRef<Mesh>(null);
  const camera = useThree((s) => s.camera);
  const viewport = useThree((s) => s.size);
  const body = useTrajectoriesStore((s) => s.bodies[bodyId]);
  const radius = body?.radius;
  const surfaceGeometry = useMemo(() => (radius != null ? createBodySurfaceGeometry(radius) : undefined), [radius]);

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return;

    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.layers.set(RENDER_LAYERS.baseBody);
    const spinGroup = spinGroupRef.current;

    const store = useTrajectoriesStore.getState();
    const { curves } = store;
    const t = store.getSimTime();

    const bodyCurve = curves[bodyId];
    const vehicleCurve = curves[vehicleId];
    if (!bodyCurve || !vehicleCurve) return;
    const vehicle = store.vehicles[vehicleId];
    const controls = store.vehicleControls[vehicleId];
    const hideForLocalSurface =
      vehicle ?
        shouldHideBodySphereForLocalSurface({
          bodyId,
          vehicleParentId: vehicle.parentId,
          surfaceState: controls?.surfaceState ?? 'flying',
          cameraDistance: camera.position.length(),
        })
      : false;
    const bodyPos = evaluateCurve(bodyCurve, t);
    const vehiclePos = evaluateCurve(vehicleCurve, t);
    const renderBody =
      body.emissive ?
        projectDistantSphere(vehiclePos as Vec3, bodyPos as Vec3, body.radius, SUN_RENDER_DISTANCE)
      : null;

    // Floating origin centered on vehicle. Keep placement on the rotating group
    // so spin/tilt changes texture orientation without rotating body position.
    const scenePosition: [number, number, number] =
      renderBody ?
        renderBody.position
      : [bodyPos[0] - vehiclePos[0], bodyPos[1] - vehiclePos[1], bodyPos[2] - vehiclePos[2]];
    const cameraRelative: Vec3 = [
      camera.position.x - scenePosition[0],
      camera.position.y - scenePosition[1],
      camera.position.z - scenePosition[2],
    ];
    const vehicleRelative: Vec3 = [vehiclePos[0] - bodyPos[0], vehiclePos[1] - bodyPos[1], vehiclePos[2] - bodyPos[2]];
    const surfaceDecision = vehiclePlanetSurfaceRenderDecision({
      bodyId,
      vehicleParentId: vehicle?.parentId,
      bodyRadius: body.radius,
      bodyDistance: Math.hypot(...vehicleRelative),
      localCameraDistance: camera.position.length(),
      cameraDistance: Math.hypot(...cameraRelative),
      fovRadians: 'fov' in camera ? (camera.fov * Math.PI) / 180 : Math.PI / 3,
      viewportHeight: viewport.height,
    });
    const transform = vehicleBodyTransform(scenePosition);
    if (spinGroup) spinGroup.position.set(...transform.groupPosition);
    mesh.position.set(...transform.meshPosition);

    if (renderBody) {
      mesh.scale.setScalar(renderBody.radius / body.radius);
    } else {
      mesh.scale.setScalar(1);
    }

    if (spinGroup) {
      spinGroup.rotation.set(
        ...bodySurfaceOrientationEuler({
          rotationPhase: body.rotationPhase,
          angularVelocity: body.angularVelocity,
          simTime: t,
          axialTilt: body.axialTilt,
        }),
      );
    }

    const sunOccluded =
      body.emissive ?
        isSunOccluded(
          vehiclePos as Vec3,
          bodyPos as Vec3,
          visibleBodyIds
            .filter((id) => id !== bodyId)
            .map((id): SunOccluder | null => {
              const occluder = store.bodies[id];
              const occluderCurve = curves[id];
              if (!occluder || !occluderCurve) return null;
              return {
                id,
                position: evaluateCurve(occluderCurve, t) as Vec3,
                radius: occluder.radius,
              };
            })
            .filter((occluder): occluder is SunOccluder => occluder !== null),
        )
      : false;

    mesh.visible = !sunOccluded && !hideForLocalSurface && surfaceDecision.showFallbackSphere;

    if (body.emissive && mesh.material && 'opacity' in mesh.material) {
      const material = mesh.material as MeshBasicMaterial;
      material.opacity = sunOccluded ? 0 : 1;
      material.transparent = sunOccluded;
    }
  });

  if (!body) return null;

  return (
    <group>
      <group ref={spinGroupRef}>
        <mesh
          ref={meshRef}
          geometry={surfaceGeometry}
        >
          <BodyMaterial body={body} />
        </mesh>
      </group>
    </group>
  );
}

function VehicleSunLight({ vehicleId, visibleBodyIds }: { vehicleId: string; visibleBodyIds: string[] }) {
  const lightRef = useRef<DirectionalLight>(null);

  useFrame(() => {
    if (useModeStore.getState().activeView !== 'vehicle') return;

    const light = lightRef.current;
    if (!light) return;
    enableRenderableLayers(light.layers);

    const store = useTrajectoriesStore.getState();
    const { curves, bodies } = store;
    const t = store.getSimTime();
    const sun = Object.values(bodies).find((body) => body.emissive);
    const sunCurve = sun ? curves[sun.id] : undefined;
    const vehicleCurve = curves[vehicleId];
    if (!sun || !sunCurve || !vehicleCurve) return;

    const sunPos = evaluateCurve(sunCurve, t) as Vec3;
    const vehiclePos = evaluateCurve(vehicleCurve, t) as Vec3;
    const sunOccluded = isSunOccluded(
      vehiclePos,
      sunPos,
      visibleBodyIds
        .filter((id) => id !== sun.id)
        .map((id): SunOccluder | null => {
          const occluder = bodies[id];
          const occluderCurve = curves[id];
          if (!occluder || !occluderCurve) return null;
          return {
            id,
            position: evaluateCurve(occluderCurve, t) as Vec3,
            radius: occluder.radius,
          };
        })
        .filter((occluder): occluder is SunOccluder => occluder !== null),
    );
    const lightPosition = vehicleSceneSunLightPosition(vehiclePos, sunPos, SUN_RENDER_DISTANCE);
    light.position.set(...lightPosition);
    light.intensity = vehicleSceneSunLightIntensity(sunOccluded);
  });

  return (
    <directionalLight
      ref={lightRef}
      intensity={2}
    />
  );
}

function VehicleAmbientLight() {
  const lightRef = useRef<AmbientLight>(null);

  // Render layers don't change after mount — set them once instead of per frame.
  useEffect(() => {
    if (lightRef.current) enableRenderableLayers(lightRef.current.layers);
  }, []);

  return (
    <ambientLight
      ref={lightRef}
      intensity={0.04}
    />
  );
}

function VehicleMesh() {
  countRender('VehicleMesh');
  const groupRef = useRef<Group>(null);
  const flameRef = useRef<Mesh>(null);
  const vehicles = useTrajectoriesStore((s) => s.vehicles);
  const showRotationAxes = useModeStore((s) => s.showRotationAxes);
  const firstVehicle = Object.values(vehicles)[0];
  const vehicleId = firstVehicle?.id;
  const hasParts = useVehicleStore((s) => (vehicleId ? !!s.models[vehicleId]?.parts : false));

  // Read the high-frequency control state imperatively each frame instead of
  // subscribing to it (which would re-render this tree ~100x/s). Same pattern
  // the orbital Body uses to keep itself off React's render path.
  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    setLayerRecursively(group, RENDER_LAYERS.vehicle);
    if (!vehicleId) return;
    const controls = useTrajectoriesStore.getState().vehicleControls[vehicleId];
    if (!controls) return;
    if (allFinite(controls.orientation)) {
      const [x, y, z, w] = controls.orientation;
      group.quaternion.set(x, y, z, w);
    }
    if (flameRef.current) flameRef.current.visible = controls.throttle > 0;
  });

  // Multi-part craft: Vessel assembles the parts and (when debug is on) hosts the
  // FlightDebugOverlay inside its oriented / CoM-pivoted / vehicle-layer group.
  if (hasParts && vehicleId) {
    return <Vessel vehicleId={vehicleId} />;
  }

  return (
    <group ref={groupRef}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[1, 1.5, 4, 8]} />
        <meshStandardMaterial color='#cccccc' />
      </mesh>
      <mesh
        ref={flameRef}
        position={[0, 0, -3]}
        visible={false}
      >
        <sphereGeometry args={[0.7, 12, 8]} />
        <meshBasicMaterial color='#ff8a18' />
      </mesh>
      {showRotationAxes && vehicleId && <VehicleDebugAxes vehicleId={vehicleId} />}
    </group>
  );
}

/** Debug-only; isolated so its per-tick control subscription re-renders just the
 * axes, not the whole VehicleMesh tree. Not mounted during normal play. */
function VehicleDebugAxes({ vehicleId }: { vehicleId: string }) {
  const controls = useTrajectoriesStore((s) => s.vehicleControls[vehicleId]);
  return (
    <CraftDebugAxes
      length={3}
      aeroForceWorld={controls?.aeroForceWorld}
      orientation={controls?.orientation}
    />
  );
}

/**
 * Enable the renderable layers on the main camera so the RenderPipeline's single
 * `pass` draws base body, terrain overlay, and vehicle into one coherent depth
 * buffer. This replaces the old manual per-layer multi-pass loop with its
 * inter-pass depth clears; the vehicle canvas uses a reversed-Z depth buffer so the
 * near vehicle and far planet coexist across the wide near/far range without
 * z-fighting (what the depth clear used to paper over).
 */
function EnableSceneLayers() {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    enableRenderableLayers(camera.layers);
  }, [camera]);
  return null;
}

function VehicleSceneContent() {
  const vehicles = useTrajectoriesStore((s) => s.vehicles);
  const bodies = useTrajectoriesStore((s) => s.bodies);

  const vehicleEntries = Object.values(vehicles);
  const firstVehicle = vehicleEntries[0] as (typeof vehicleEntries)[number] | undefined;

  const visibleBodyIds = firstVehicle ? getCelestialHierarchy(bodies, firstVehicle.parentId) : [];

  return (
    <>
      <VehicleAmbientLight />
      <VehicleSky />
      <VehicleViewControls />
      <RenderPipeline
        withBloom
        withLensFlare
      />
      <EnableSceneLayers />
      <VehicleMesh />
      {firstVehicle && (
        <VehicleSunLight
          vehicleId={firstVehicle.id}
          visibleBodyIds={visibleBodyIds}
        />
      )}
      {firstVehicle &&
        visibleBodyIds.map((id) => (
          <VehicleBody
            key={id}
            bodyId={id}
            vehicleId={firstVehicle.id}
            visibleBodyIds={visibleBodyIds}
          />
        ))}
      {/* AtmosphereShell (v1 GLSL ShaderMaterial) is unmounted: it doesn't compile
          under the WebGPU backend and the atmosphere effort is being re-approached
          as a node/TSL pass on the new RenderPipeline. The file is kept for reference. */}
      {firstVehicle && (
        <PlanetTerrainTiles
          bodyId={firstVehicle.parentId}
          vehicleId={firstVehicle.id}
        />
      )}
    </>
  );
}

function VehicleViewControls() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const targetUpRef = useRef(new Vector3(0, 1, 0));
  const surfaceCameraInitializedRef = useRef(false);
  const camera = useThree((s) => s.camera);

  // Cap zoom-out (reactive: re-evaluates if the parent changes), clamped to 10 km below.
  const parentRadius = useTrajectoriesStore((s) => {
    const vehicle = Object.values(s.vehicles)[0];
    const parent = vehicle ? s.bodies[vehicle.parentId] : undefined;
    return parent?.radius;
  });
  const maxDistance = Math.min(
    parentRadius != null ? parentRadius * VEHICLE_VIEW_MAX_RADII : VEHICLE_VIEW_MAX_DISTANCE_FALLBACK,
    VEHICLE_VIEW_MAX_DISTANCE,
  );

  useFrame((_, delta) => {
    const store = useTrajectoriesStore.getState();
    const vehicle = Object.values(store.vehicles)[0];
    if (!vehicle) return;
    const parent = store.bodies[vehicle.parentId];
    const vehicleCurve = store.curves[vehicle.id];
    const parentCurve = store.curves[vehicle.parentId];
    if (!parent || !vehicleCurve || !parentCurve) return;

    const t = store.getSimTime();
    const vehiclePosition = evaluateCurve(vehicleCurve, t) as Vec3;
    const parentPosition = evaluateCurve(parentCurve, t) as Vec3;
    const vehicleVelocity = evaluateCurveVelocity(vehicleCurve, t) as Vec3;
    const parentVelocity = evaluateCurveVelocity(parentCurve, t) as Vec3;
    const controls = store.vehicleControls[vehicle.id];
    const surfaceState = controls?.surfaceState ?? 'flying';
    const relativePosition: Vec3 = [
      vehiclePosition[0] - parentPosition[0],
      vehiclePosition[1] - parentPosition[1],
      vehiclePosition[2] - parentPosition[2],
    ];
    const relativeVelocity: Vec3 = [
      vehicleVelocity[0] - parentVelocity[0],
      vehicleVelocity[1] - parentVelocity[1],
      vehicleVelocity[2] - parentVelocity[2],
    ];
    const parentRotationAxis = rotationAxisFromAxialTilt(parent.axialTilt);
    const frame = computeFlightReferenceFrame({
      relativePosition,
      relativeVelocity,
      parentRadius: parent.radius,
      parentGm: parent.gm,
      parentAngularVelocity: parent.angularVelocity,
      parentRotationAxis,
      surfaceState,
    });

    // No camera co-rotation while landed: the sim co-rotates the vehicle with the
    // surface (worker.ts rotatingSurfaceState), and the planet/terrain render at
    // (bodyPos − vehiclePos) spun by the body's absolute orientation — the same
    // rotation the orbital view uses — so the crust point under the craft already
    // renders fixed at the scene origin. Rotating the camera too would double the
    // spin and make the ground appear to slide backwards (west). Sunrise still
    // happens: the sun direction sweeps across the fixed surface as the planet turns.

    const targetUp =
      frame.mode === 'surface' ?
        ([frame.radialOut[0], frame.radialOut[1], frame.radialOut[2]] as const)
      : ([0, 1, 0] as const);
    targetUpRef.current.set(targetUp[0], targetUp[1], targetUp[2]);
    if (surfaceState !== 'flying') {
      // Wall-clock-paced lerp can't keep up with sim-time-paced radialOut
      // rotation under warp, leaving a constant tilt lag. Snap once landed —
      // smoothing only matters during the orbital↔surface transition.
      camera.up.copy(targetUpRef.current).normalize();
    } else {
      camera.up.lerp(targetUpRef.current, cameraUpLerpAlpha(delta)).normalize();
    }
    if (frame.mode === 'surface' && !surfaceCameraInitializedRef.current) {
      // Default to an elevated view from the south (north toward screen-top).
      const tangent = surfaceFrame(relativePosition, parentRotationAxis);
      const south: Vec3 = tangent ? [-tangent.north[0], -tangent.north[1], -tangent.north[2]] : [0, 0, 0];
      camera.position.set(...surfaceCameraPosition(frame.radialOut, south, 18, 22));
      surfaceCameraInitializedRef.current = true;
    }
    // Keep the camera outside the planet (its centre is at -relativePosition in this
    // vehicle-origin frame) so you can look around freely — even up at the sky — without
    // it dropping below the ground. Replaces the old flat tangent-plane clamp that
    // pinned the camera above the vehicle and made looking up impossible. Harmless when
    // flying (the camera is far from the planet centre, so it never engages).
    clampOutsideSphere(
      camera.position,
      -relativePosition[0],
      -relativePosition[1],
      -relativePosition[2],
      parent.radius + SURFACE_CAMERA_MIN_HEIGHT,
    );
    if (frame.mode !== 'surface') {
      surfaceCameraInitializedRef.current = false;
    }
    controlsRef.current?.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      minDistance={VEHICLE_VIEW_MIN_DISTANCE}
      maxDistance={maxDistance}
    />
  );
}

export function VehicleScene() {
  const active = useModeStore((s) => s.activeView === 'vehicle');

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        display: active ? 'block' : 'none',
      }}
    >
      <Canvas
        camera={{ position: [0, 10, 30], near: 0.1, far: 1e9, fov: 50 }}
        gl={makeWebGPURenderer({ reversedDepthBuffer: true })}
        style={{ width: '100%', height: '100%' }}
      >
        <PerfLogger view='vehicle' />
        <VehicleSceneContent />
      </Canvas>
    </div>
  );
}

function enableRenderableLayers(layers: { enable: (layer: number) => void }) {
  layers.enable(RENDER_LAYERS.baseBody);
  layers.enable(RENDER_LAYERS.terrainOverlay);
  layers.enable(RENDER_LAYERS.vehicle);
}

function setLayerRecursively(object: Object3D, layer: number) {
  object.layers.set(layer);
  for (const child of object.children) setLayerRecursively(child, layer);
}
