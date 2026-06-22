import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AdditiveBlending, BackSide, Color, Mesh, Points, Quaternion, Vector3 } from 'three';
import { MeshBasicNodeMaterial, PointsNodeMaterial, RenderPipeline as WebGPURenderPipeline } from 'three/webgpu';
import type { WebGPURenderer } from 'three/webgpu';
import { attribute, cameraPosition, color, float, mix, pass, positionWorld, uniform, vec3 } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { lensflare } from 'three/examples/jsm/tsl/display/LensflareNode.js';
import { makeWebGPURenderer } from '../render/webgpuRenderer';
import { createStarfieldWithMagnitudes } from '../render/sky/starfieldGeometry';
import {
  computeSunHorizon,
  createTwilightColumnSampler,
  limitingMagnitude,
  twilightEndAltitude,
  twilightPhase,
  SUN_ANGULAR_RADIUS,
} from '../render/sky/sunHorizon';
import type { TwilightPhase, TwilightSlice } from '../render/sky/sunHorizon';

/**
 * Spike: estimate atmospheric effects *cheaply* from geometry alone. Twilight reduces to a
 * radial "column" of air over the observer (Alan's drawings #1–4): march it in slices and
 * at each layer ask how dense it is and whether the planet's shadow has climbed over it.
 * The shadow line rising up the column is the whole twilight mechanism. This stage proves
 * out the math (see ../render/sky/sunHorizon) with a live readout + column visualization,
 * and ignores all shading. Slide the sun and watch the shadow climb / the lit band redden.
 */

const R = 1; // planet radius, scene units
const ATMOSPHERE_THICKNESS = 0.08; // exaggerated so the column/shell are visible
const SLICES = 12;
const COLUMN_FOOTPRINT = 0.08;
const EYE_HEIGHT = 0.01; // ground-view eye offset above the surface (scene units)
const DEG = Math.PI / 180;
const PLANET_CENTER = new Vector3(0, 0, 0);

const PHASE_COLOR: Record<TwilightPhase, string> = {
  day: '#cfe8ff',
  golden: '#ff9a3c',
  civil: '#ff5e7a',
  nautical: '#5b6cff',
  astronomical: '#2b2f6b',
  night: '#0a0c1a',
};

const SHADOW_COLOR = new Color('#0a1230');
const LIT_DAY = new Color('#fff3d0');
const LIT_SUNSET = new Color('#ff4d12');

function smoothstep01(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Starfield faded by apparent magnitude, entirely on the GPU. Each star carries its
 * `magnitude` as a vertex attribute; a single `limit` uniform (the sky's limiting
 * magnitude) decides per-star brightness in a TSL node graph — no per-frame CPU work
 * beyond writing that one uniform. Brighter stars (lower magnitude) glow stronger and
 * larger; additive blending means a sub-threshold star adds no light and vanishes on any
 * background. Brightest emerge first at dusk, faintest only at full dark.
 */
const STAR_FADE = 1.2; // magnitudes of soft edge around the limit

function MagnitudeStars({ limitingMag }: { limitingMag: number }) {
  const ref = useRef<Points>(null);

  const { geometry, material } = useMemo(() => {
    const geometry = createStarfieldWithMagnitudes(40, 1800);
    const limit = uniform(0); // updated each frame from the prop
    const mag = attribute('magnitude', 'float');
    // Visible once the limit rises past this star's magnitude (soft over STAR_FADE mags).
    const visible = mag.smoothstep(limit.sub(STAR_FADE), limit.add(STAR_FADE)).oneMinus();
    const intrinsic = float(1.1).sub(mag.add(1.5).mul(0.1)).clamp(0.35, 1.15);
    const brightness = visible.mul(intrinsic);

    const material = new PointsNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    material.colorNode = vec3(brightness.mul(0.92), brightness.mul(0.96), brightness);
    material.sizeNode = brightness.mul(2.0).add(1.0);
    material.sizeAttenuation = false;
    material.userData.limit = limit;
    return { geometry, material };
  }, []);

  useFrame(() => {
    const limit = (ref.current?.material as PointsNodeMaterial | undefined)?.userData.limit as
      | { value: number }
      | undefined;
    if (limit) limit.value = limitingMag;
  });

  useEffect(
    () => () => {
      material.dispose();
      geometry.dispose();
    },
    [material, geometry],
  );

  return (
    <points
      ref={ref}
      geometry={geometry}
      material={material}
    />
  );
}

/**
 * Analytic TSL sky dome — the cheap stand-in for Rayleigh scattering. Each fragment's
 * color is a function of its view direction vs. the sun and the observer's horizon, so the
 * warm glow localizes into a forward lobe toward the sun hugging the horizon, fading to a
 * blue zenith gradient away from it and to black below the horizon / at night / in space.
 * Driven entirely by uniforms we already have (sun dir, up, sky illumination, glow), no LUT.
 */
const ZENITH_BLUE = '#2a62c4'; // bright-ish overhead, not navy
const HORIZON_BLUE = '#a9c6ec'; // pale haze at the horizon
const SUN_HALO = '#fff0d8'; // whitening around the sun disc
const GLOW_WARM = '#ff7a26'; // bright orange sunset band hugging the horizon
const SUNSET_RED = '#ff3a0e'; // deep red the sky base shifts toward as the air reddens

function SkyDome({
  sunDir,
  up,
  skyIllum,
  glow,
  redness,
  darkening,
  horizonLevel,
}: {
  sunDir: Vector3;
  up: Vector3;
  skyIllum: number;
  glow: number;
  redness: number;
  darkening: number;
  horizonLevel: number;
}) {
  const ref = useRef<Mesh>(null);

  const material = useMemo(() => {
    const sunU = uniform(new Vector3());
    const upU = uniform(new Vector3());
    const illumU = uniform(0);
    const glowU = uniform(0);
    const rednessU = uniform(0);
    const darkenU = uniform(0);
    const horizonU = uniform(0); // view·up of the true horizon (= -sin(horizon dip)), negative

    const view = positionWorld.sub(cameraPosition).normalize();
    const sunCos = view.dot(sunU);
    const upCos = view.dot(upU);
    // Sky stays full-bright right down to the geometric horizon (which dips below horizontal by
    // the horizon-dip angle, more with altitude), then cuts off just under it — the opaque planet
    // occludes everything lower, so there's no black gap between the sky and the limb.
    const aboveHorizon = upCos.smoothstep(horizonU.sub(0.08), horizonU);

    // Two angular weights reused throughout: proximity to the sun's azimuth (1 at the sun, 0
    // directly opposite) and proximity to the horizon (1 at the limb, 0 by ~37° elevation).
    const towardSun = sunCos.mul(0.5).add(0.5);
    const horizonProx = upCos.smoothstep(0.6, horizonU);

    // Base sky: blue Rayleigh gradient (pale at the horizon, richer overhead) shifted toward a
    // deep sunset red where the air is reddening the light. The shift is the whole sunset: it
    // scales with `redness`, concentrated low and toward the sun, so the sky genuinely turns
    // orange/red there rather than staying blue with a warm dot on top.
    const horizonFactor = upCos.max(0).oneMinus();
    const dayColor = mix(color(ZENITH_BLUE), color(HORIZON_BLUE), horizonFactor);
    const redMix = rednessU.mul(towardSun).mul(horizonProx).clamp(0, 1);
    const baseColor = mix(dayColor, color(SUNSET_RED), redMix);

    // At twilight (darkenU→1) darken the sky opposite the sun — the rising Earth-shadow side.
    // antiSun goes 1 toward the sun → 0.1 directly away from it; no effect by day (darkenU ~0).
    const antiSun = mix(float(1), towardSun.clamp(0.1, 1), darkenU);
    const litSky = baseColor.mul(illumU).mul(antiSun);

    // Sun halo: whitens the sky tightly around the sun at any elevation, so a high sun (and the
    // zenith near it) reads bright rather than dark.
    const aureole = color(SUN_HALO).mul(sunCos.max(0).pow(8).mul(illumU).mul(0.6));

    // Warm sunset band: a broad bright lobe toward the sun hugging the horizon. Broader (pow 3)
    // and stronger than before so the glow reads as a wide band, not a pinpoint.
    const sunGlow = color(GLOW_WARM).mul(towardSun.pow(3).mul(horizonProx).mul(glowU).mul(1.6));

    const material = new MeshBasicNodeMaterial({
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    material.colorNode = litSky.add(aureole).add(sunGlow).mul(aboveHorizon);
    material.userData = { sunU, upU, illumU, glowU, rednessU, darkenU, horizonU };
    return material;
  }, []);

  useFrame((state) => {
    const dome = ref.current;
    if (!dome) return;
    dome.position.copy(state.camera.position); // skybox: always centered on the camera
    const u = dome.material.userData as {
      sunU: { value: Vector3 };
      upU: { value: Vector3 };
      illumU: { value: number };
      glowU: { value: number };
      rednessU: { value: number };
      darkenU: { value: number };
      horizonU: { value: number };
    };
    u.sunU.value.copy(sunDir);
    u.upU.value.copy(up);
    u.illumU.value = skyIllum;
    u.glowU.value = glow;
    u.rednessU.value = redness;
    u.darkenU.value = darkening;
    u.horizonU.value = horizonLevel;
  });

  useEffect(() => () => material.dispose(), [material]);

  return (
    <mesh
      ref={ref}
      material={material}
      renderOrder={-1}
    >
      <sphereGeometry args={[30, 48, 24]} />
    </mesh>
  );
}

/**
 * Spike-local post pipeline: scene → bloom → lens flare. Bloom catches the HDR-bright sun
 * disc (and a touch of the brightest sky), and the lens flare samples that bloom to throw
 * ghosts pivoting around screen-center. Kept local to the spike so the shared RenderPipeline
 * stays a plain passthrough.
 */
function SkyPipeline() {
  const gl = useThree((s) => s.gl) as unknown as WebGPURenderer;
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const pipeline = useMemo(() => {
    const p = new WebGPURenderPipeline(gl);
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');
    const bloomPass = bloom(sceneColor, 0.85, 0.7, 0.8);
    const flare = lensflare(bloomPass, {
      ghostTint: vec3(1.0, 0.85, 0.55),
      threshold: 0.6,
      ghostSamples: 4,
      ghostSpacing: 0.25,
      ghostAttenuationFactor: 25,
    });
    p.outputNode = sceneColor.add(bloomPass).add(flare);
    return p;
  }, [gl, scene, camera]);

  useEffect(() => () => pipeline.dispose(), [pipeline]);
  useFrame(() => pipeline.render(), 1);
  return null;
}

const Z_AXIS = new Vector3(0, 0, 1);
const X_AXIS = new Vector3(1, 0, 0);

/**
 * First-person camera standing at the observer, aimed by yaw/pitch in the local horizon
 * frame. This is the honest way to see the sky as a wrap-around dome (and how it renders
 * in-game), versus the orbit view which shows the same hemisphere as a slab from outside.
 * Click-drag on the canvas pans the look direction (cursor leads your gaze); the sliders
 * remain a precise alternative since both feed the same yaw/pitch state.
 */
function GroundCamera({
  observer,
  up,
  yawDeg,
  pitchDeg,
  onDrag,
}: {
  observer: Vector3;
  up: Vector3;
  yawDeg: number;
  pitchDeg: number;
  onDrag: (dYawDeg: number, dPitchDeg: number) => void;
}) {
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      onDrag(dx * 0.3, -dy * 0.3); // cursor leads gaze: drag right→look right, drag up→look up
    };
    const onUp = () => {
      dragging = false;
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl, onDrag]);

  useFrame((state) => {
    const ref = Math.abs(up.z) < 0.99 ? Z_AXIS : X_AXIS;
    const tangentA = new Vector3().crossVectors(up, ref).normalize();
    const tangentB = new Vector3().crossVectors(up, tangentA).normalize();
    const yaw = yawDeg * DEG;
    const pitch = pitchDeg * DEG;
    const dir = tangentA
      .multiplyScalar(Math.cos(yaw))
      .addScaledVector(tangentB, Math.sin(yaw))
      .multiplyScalar(Math.cos(pitch))
      .addScaledVector(up, Math.sin(pitch));
    const cam = state.camera;
    cam.position.copy(observer).addScaledVector(up, EYE_HEIGHT); // eye just above the surface
    cam.up.copy(up);
    cam.lookAt(observer.x + dir.x, observer.y + dir.y, observer.z + dir.z);
  });
  return null;
}

/** Stacked rings up the radial column, lit→warm/orange and shadowed→dark, dimmed by density. */
function ColumnSlices({ up, samples, redness }: { up: Vector3; samples: TwilightSlice[]; redness: number }) {
  const ringQuat = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), up), [up]);
  const litColor = useMemo(() => LIT_DAY.clone().lerp(LIT_SUNSET, redness), [redness]);

  const rings = useMemo(
    () =>
      samples.map((s) => {
        const position = up.clone().multiplyScalar(R + s.altitude);
        const color = SHADOW_COLOR.clone()
          .lerp(litColor, s.lit)
          .multiplyScalar(0.35 + 0.65 * s.density);
        return { position: position.toArray() as [number, number, number], color };
      }),
    [up, samples, litColor],
  );

  return (
    <>
      {rings.map((ring, i) => (
        <mesh
          key={i}
          position={ring.position}
          quaternion={ringQuat}
        >
          <torusGeometry args={[COLUMN_FOOTPRINT, 0.005, 6, 48]} />
          <meshBasicMaterial color={ring.color} />
        </mesh>
      ))}
    </>
  );
}

function HorizonScene({
  observer,
  up,
  sunDir,
  samples,
  redness,
  skyIllum,
  glow,
  darkening,
  horizonLevel,
  limitingMag,
  viewMode,
  lookYaw,
  lookPitch,
  onLookDrag,
}: {
  observer: Vector3;
  up: Vector3;
  sunDir: Vector3;
  samples: TwilightSlice[];
  redness: number;
  skyIllum: number;
  glow: number;
  darkening: number;
  horizonLevel: number;
  limitingMag: number;
  viewMode: 'orbit' | 'ground';
  lookYaw: number;
  lookPitch: number;
  onLookDrag: (dYawDeg: number, dPitchDeg: number) => void;
}) {
  const ringQuat = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), up), [up]);
  const sunMarker = useMemo(() => observer.clone().addScaledVector(sunDir, 2.2), [observer, sunDir]);

  // HDR-bright sun disc so the bloom/lens-flare pipeline has a bright spot to work from.
  const sunMaterial = useMemo(() => {
    const m = new MeshBasicNodeMaterial();
    m.colorNode = color('#fff2cf').mul(5);
    return m;
  }, []);
  useEffect(() => () => sunMaterial.dispose(), [sunMaterial]);

  return (
    <>
      <SkyPipeline />
      <color
        attach='background'
        args={[0, 0, 0]}
      />
      {/* The dome is a camera-locked skybox — only meaningful standing on the ground. From orbit
          it would wrap the free-flying camera as a nonsensical half-dome, so show it in ground
          view only; orbit relies on the faint atmosphere shell mesh below to read the air layer. */}
      {viewMode === 'ground' && (
        <SkyDome
          sunDir={sunDir}
          up={up}
          skyIllum={skyIllum}
          glow={glow}
          redness={redness}
          darkening={darkening}
          horizonLevel={horizonLevel}
        />
      )}
      <MagnitudeStars limitingMag={limitingMag} />
      <directionalLight
        position={sunDir.toArray()}
        intensity={2.5}
      />
      <ambientLight intensity={0.15} />

      {/* Planet */}
      <mesh>
        <sphereGeometry args={[R, 96, 48]} />
        <meshStandardMaterial
          color='#2a3a4a'
          roughness={1}
        />
      </mesh>

      {/* Atmosphere shell (the column rises to here) */}
      <mesh>
        <sphereGeometry args={[R + ATMOSPHERE_THICKNESS, 96, 48]} />
        <meshBasicMaterial
          color='#5b8bd0'
          transparent
          opacity={0.06}
          side={BackSide}
          depthWrite={false}
        />
      </mesh>

      {/* Orbit-only diagram aids — observer marker, horizon ring, column rings. In the ground
          view these would sit on top of the camera, so hide them there. */}
      {viewMode === 'orbit' && (
        <>
          <mesh position={observer.toArray()}>
            <sphereGeometry args={[0.02, 16, 16]} />
            <meshBasicMaterial color='#ffffff' />
          </mesh>
          <mesh
            position={observer.toArray()}
            quaternion={ringQuat}
          >
            <torusGeometry args={[0.28, 0.003, 8, 64]} />
            <meshBasicMaterial color='#3fa9ff' />
          </mesh>
          <ColumnSlices
            up={up}
            samples={samples}
            redness={redness}
          />
        </>
      )}

      {/* Sun marker (HDR-bright — drives bloom + lens flare) */}
      <mesh
        position={sunMarker.toArray()}
        material={sunMaterial}
      >
        <sphereGeometry args={[0.06, 16, 16]} />
      </mesh>

      {viewMode === 'orbit' ? (
        <OrbitControls
          target={observer.toArray()}
          minDistance={0.4}
          maxDistance={12}
        />
      ) : (
        <GroundCamera
          observer={observer}
          up={up}
          yawDeg={lookYaw}
          pitchDeg={lookPitch}
          onDrag={onLookDrag}
        />
      )}
    </>
  );
}

export function DawnSpikePage() {
  const [latitudeDeg, setLatitudeDeg] = useState(90);
  const [sunAngleDeg, setSunAngleDeg] = useState(70);
  const [heightShells, setHeightShells] = useState(0);
  const [viewMode, setViewMode] = useState<'orbit' | 'ground'>('ground');
  const [lookYaw, setLookYaw] = useState(0);
  const [lookPitch, setLookPitch] = useState(20);

  const lat = latitudeDeg * DEG;
  const sunAngle = sunAngleDeg * DEG;

  const up = useMemo(() => new Vector3(Math.cos(lat), Math.sin(lat), 0), [lat]);
  // Observer height measured in shell thicknesses, so the climb-out / far-field skip is reachable.
  const observer = useMemo(() => up.clone().multiplyScalar(R + heightShells * ATMOSPHERE_THICKNESS), [up, heightShells]);
  const sunDir = useMemo(() => new Vector3(Math.cos(sunAngle), Math.sin(sunAngle), 0), [sunAngle]);

  const horizon = computeSunHorizon(observer, PLANET_CENTER, R, sunDir, SUN_ANGULAR_RADIUS);
  const phase = twilightPhase(horizon.altitude);

  // Throttled + far-field-skipped sampler (the in-game pattern): recomputes only when the sun
  // or observer altitude crosses a fine bucket, and skips entirely outside the atmosphere.
  const sampler = useMemo(() => createTwilightColumnSampler(), []);
  const column = sampler.sample({
    observer,
    planetCenter: PLANET_CENTER,
    planetRadius: R,
    atmosphereThickness: ATMOSPHERE_THICKNESS,
    sunDirection: sunDir,
    slices: SLICES,
    includeSamples: true,
  });
  const samples = column.samples ?? [];

  const twilightEndDeg = twilightEndAltitude(R, ATMOSPHERE_THICKNESS) / DEG;

  // Warm-glow strength for the sky dome: a window peaking at the horizon (rises through dusk,
  // gone by full day and by deep twilight), tinted by redness and killed in space (airAbove).
  const sunAltDeg = horizon.altitude / DEG;
  const glowBand = smoothstep01(-12, 0, sunAltDeg) * (1 - smoothstep01(0, 9, sunAltDeg));
  const glow = glowBand * column.redness * column.airAbove;

  // Anti-sun darkening strength: ~0 with the sun well up (sky reads uniform), ramping to full
  // as it nears and drops below the horizon (Earth's shadow rising opposite the sun). Decoupled
  // from `glow` (which is tiny mid-twilight) so the effect is actually visible. Killed in space.
  const darkening = smoothstep01(15, -3, sunAltDeg) * column.airAbove;

  // view·up of the true horizon: the limb sits below horizontal by the horizon-dip angle, so the
  // sky dome can stay full-bright right down to it (the planet occludes everything lower). Derived
  // from the camera EYE radius (not the observer radius) so it matches the rendered limb exactly —
  // dip is very sensitive near the surface, where eye height alone swings it several degrees.
  const eyeRadius = observer.length() + EYE_HEIGHT;
  const horizonLevel = -Math.sqrt(Math.max(0, 1 - (R / eyeRadius) ** 2));

  // Stars fade against the sky's limiting magnitude, grounded in the twilight definitions.
  const limitingMag = limitingMagnitude(horizon.altitude, column.airAbove);

  // Drag-to-look: accumulate yaw/pitch via functional updates (no stale closure), wrapping yaw
  // into [-180,180] and clamping pitch to the slider range so both inputs stay in sync.
  const onLookDrag = useCallback((dYaw: number, dPitch: number) => {
    setLookYaw((y) => ((((y + dYaw) % 360) + 540) % 360) - 180);
    setLookPitch((p) => Math.max(-30, Math.min(90, p + dPitch)));
  }, []);

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#05070d' }}>
      <Canvas
        camera={{ position: [2.6, 1.6, 2.6], near: 0.01, far: 100, fov: 45 }}
        gl={makeWebGPURenderer()}
      >
        <HorizonScene
          observer={observer}
          up={up}
          sunDir={sunDir}
          samples={samples}
          redness={column.redness}
          skyIllum={column.skyIllumination}
          glow={glow}
          darkening={darkening}
          horizonLevel={horizonLevel}
          limitingMag={limitingMag}
          viewMode={viewMode}
          lookYaw={lookYaw}
          lookPitch={lookPitch}
          onLookDrag={onLookDrag}
        />
      </Canvas>

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          padding: 14,
          background: 'rgba(0,0,0,0.62)',
          color: '#ddd',
          font: '12px monospace',
          borderRadius: 6,
          width: 320,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Dawn spike — twilight column (geometry only)</div>

        <Readout
          label='sun altitude (true horizon)'
          value={`${(horizon.altitude / DEG).toFixed(2)}°`}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }}>
          <span style={{ opacity: 0.7 }}>phase</span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: PHASE_COLOR[phase],
              color: phase === 'day' || phase === 'golden' ? '#000' : '#fff',
              fontWeight: 700,
            }}
          >
            {phase}
          </span>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.15)', margin: '8px 0' }} />

        <Readout
          label='lit fraction'
          value={column.litFraction.toFixed(3)}
        />
        <Readout
          label='intensity'
          value={column.intensity.toFixed(3)}
        />
        <Readout
          label='redness'
          value={column.redness.toFixed(3)}
        />
        <Readout
          label='shadow height'
          value={`${((column.shadowHeight / ATMOSPHERE_THICKNESS) * 100).toFixed(0)}% of shell`}
        />
        <Readout
          label='sun-beam airmass'
          value={`${column.airmass.toFixed(1)}×`}
        />
        <Readout
          label='atmosphere overhead'
          value={`${(column.airAbove * 100).toFixed(0)}%`}
        />
        <Readout
          label='sky illumination'
          value={column.skyIllumination.toFixed(3)}
        />
        <Readout
          label='limiting magnitude'
          value={`${limitingMag.toFixed(1)} mag`}
        />
        <Readout
          label='twilight ends at'
          value={`${twilightEndDeg.toFixed(1)}°`}
        />
        <Readout
          label='atmosphere gate'
          value={sampler.active ? 'ACTIVE' : 'SKIPPED (space)'}
        />
        <Readout
          label='column recomputes'
          value={`${sampler.recomputes}`}
        />

        <div style={{ height: 1, background: 'rgba(255,255,255,0.15)', margin: '8px 0' }} />

        <button
          onClick={() => setViewMode((m) => (m === 'orbit' ? 'ground' : 'orbit'))}
          style={{
            width: '100%',
            padding: '6px 0',
            marginBottom: 4,
            background: 'rgba(100,180,255,0.15)',
            color: '#dff',
            border: '1px solid rgba(100,180,255,0.4)',
            borderRadius: 4,
            cursor: 'pointer',
            font: '12px monospace',
          }}
        >
          view: {viewMode === 'ground' ? 'GROUND (stand at lander)' : 'ORBIT (diagram)'}
        </button>
        {viewMode === 'ground' && (
          <>
            <Slider
              label={`look yaw  ${lookYaw.toFixed(0)}°`}
              min={-180}
              max={180}
              step={1}
              value={lookYaw}
              onChange={setLookYaw}
            />
            <Slider
              label={`look pitch  ${lookPitch.toFixed(0)}°`}
              min={-30}
              max={90}
              step={1}
              value={lookPitch}
              onChange={setLookPitch}
            />
          </>
        )}

        <Slider
          label={`observer latitude  ${latitudeDeg.toFixed(0)}°`}
          min={-90}
          max={90}
          step={1}
          value={latitudeDeg}
          onChange={setLatitudeDeg}
        />
        <Slider
          label={`sun angle  ${sunAngleDeg.toFixed(0)}°`}
          min={0}
          max={360}
          step={1}
          value={sunAngleDeg}
          onChange={setSunAngleDeg}
        />
        <Slider
          label={`observer height  ${(heightShells * 100).toFixed(0)}% of shell`}
          min={0}
          max={2}
          step={0.02}
          value={heightShells}
          onChange={setHeightShells}
        />

        <div style={{ marginTop: 10, opacity: 0.65 }}>
          The stacked rings are the air column over the observer; as the sun sinks the shadow band
          climbs and the lit rings redden. GROUND view stands you at the lander — drag on the scene
          to look around (or use the yaw/pitch sliders) — the sky wraps as a dome, with the warm
          glow localized toward the sun and the opposite side darkening at twilight. ORBIT view
          shows the column diagram from outside.
          Stars fade in by apparent magnitude; raise observer height to climb out and reveal them.
        </div>
      </div>
    </div>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'block', marginTop: 8 }}>
      {label}
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', display: 'block' }}
      />
    </label>
  );
}
