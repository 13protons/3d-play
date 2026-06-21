import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { AdditiveBlending, BackSide, Color, Points, Quaternion, Vector3 } from 'three';
import { makeWebGPURenderer } from '../render/webgpuRenderer';
import { RenderPipeline } from '../render/RenderPipeline';
import { createStarfieldWithMagnitudes } from '../render/sky/starfieldGeometry';
import {
  computeSunHorizon,
  limitingMagnitude,
  sampleTwilightColumn,
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
const SKY_DAY = new Color('#4a86d8');
const SKY_SUNSET = new Color('#ff6a2a');

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Starfield faded by apparent magnitude: each star shows only once the sky's limiting
 * magnitude has risen past it (brightest first, at dusk; faintest last, at full dark).
 * Additive blending means a sub-threshold star adds no light, so it vanishes on any
 * background. The per-star brightness is written into the color buffer each frame.
 */
const STAR_FADE = 1.2; // magnitudes of soft edge around the limit

function MagnitudeStars({ limitingMag }: { limitingMag: number }) {
  const geometry = useMemo(() => createStarfieldWithMagnitudes(40, 1800), []);
  const ref = useRef<Points>(null);

  useFrame(() => {
    const geo = ref.current?.geometry;
    if (!geo) return;
    const mags = geo.getAttribute('magnitude');
    const color = geo.getAttribute('color');
    for (let i = 0; i < mags.count; i++) {
      const m = mags.getX(i);
      const visible = 1 - smoothstep(limitingMag - STAR_FADE, limitingMag + STAR_FADE, m);
      // Brighter stars (lower magnitude) glow a little stronger.
      const intrinsic = Math.max(0.35, Math.min(1.15, 1.1 - 0.1 * (m + 1.5)));
      const b = visible * intrinsic;
      color.setXYZ(i, b * 0.92, b * 0.96, b);
    }
    color.needsUpdate = true;
  });

  return (
    <points
      ref={ref}
      geometry={geometry}
    >
      <pointsMaterial
        vertexColors
        size={1.8}
        sizeAttenuation={false}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </points>
  );
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
  skyColor,
  limitingMag,
}: {
  observer: Vector3;
  up: Vector3;
  sunDir: Vector3;
  samples: TwilightSlice[];
  redness: number;
  skyColor: [number, number, number];
  limitingMag: number;
}) {
  const ringQuat = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), up), [up]);
  const sunMarker = useMemo(() => observer.clone().addScaledVector(sunDir, 2.2), [observer, sunDir]);

  return (
    <>
      <RenderPipeline />
      <color
        attach='background'
        args={skyColor}
      />
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

      {/* Observer marker */}
      <mesh position={observer.toArray()}>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshBasicMaterial color='#ffffff' />
      </mesh>

      {/* Local-horizon ring (plane perpendicular to "up") */}
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

      {/* Sun marker */}
      <mesh position={sunMarker.toArray()}>
        <sphereGeometry args={[0.06, 16, 16]} />
        <meshBasicMaterial color='#ffec9e' />
      </mesh>

      <OrbitControls
        target={observer.toArray()}
        minDistance={0.4}
        maxDistance={12}
      />
    </>
  );
}

export function DawnSpikePage() {
  const [latitudeDeg, setLatitudeDeg] = useState(20);
  const [sunAngleDeg, setSunAngleDeg] = useState(70);
  const [heightR, setHeightR] = useState(0);

  const lat = latitudeDeg * DEG;
  const sunAngle = sunAngleDeg * DEG;

  const up = useMemo(() => new Vector3(Math.cos(lat), Math.sin(lat), 0), [lat]);
  const observer = useMemo(() => up.clone().multiplyScalar(R * (1 + heightR)), [up, heightR]);
  const sunDir = useMemo(() => new Vector3(Math.cos(sunAngle), Math.sin(sunAngle), 0), [sunAngle]);

  const horizon = computeSunHorizon(observer, PLANET_CENTER, R, sunDir, SUN_ANGULAR_RADIUS);
  const phase = twilightPhase(horizon.altitude);

  // Cheap enough (~tens of ns + a 12-slice loop) to run every render; the compiler memoizes.
  const column = sampleTwilightColumn({
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

  // Sky background: daylight blue → sunset orange (by redness), scaled by overall illumination.
  // Stars fade in as that illumination drops — so climbing above the atmosphere reveals them.
  const skyColor = useMemo<[number, number, number]>(() => {
    const c = SKY_DAY.clone().lerp(SKY_SUNSET, column.redness).multiplyScalar(column.skyIllumination);
    return [c.r, c.g, c.b];
  }, [column.redness, column.skyIllumination]);

  // Stars fade against the sky's limiting magnitude, grounded in the twilight definitions.
  const limitingMag = limitingMagnitude(horizon.altitude, column.airAbove);

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
          skyColor={skyColor}
          limitingMag={limitingMag}
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

        <div style={{ height: 1, background: 'rgba(255,255,255,0.15)', margin: '8px 0' }} />

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
          label={`observer height  ${(heightR * 100).toFixed(0)}% R`}
          min={0}
          max={2}
          step={0.01}
          value={heightR}
          onChange={setHeightR}
        />

        <div style={{ marginTop: 10, opacity: 0.65 }}>
          The stacked rings are the air column over the observer; as the sun sinks the shadow band
          climbs from the surface up and the lit rings redden. Stars fade in by apparent magnitude —
          brightest first at dusk, faintest only at full dark (limiting magnitude above). Raise
          observer height to climb out of the atmosphere and the whole sky reveals even in daylight.
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
