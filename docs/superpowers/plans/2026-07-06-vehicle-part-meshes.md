# Vehicle Part Meshes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat primitive shapes that draw vehicle parts with believable rocket hardware, sculpted procedurally in an authoring sandbox and baked to static `.glb` meshes that gameplay loads via `PartDefinition.meshId`.

**Architecture:** Three independent seams. (1) Pure procedural geometry builders (`src/spike/parts/`) return THREE `Group`s in a fixed convention. (2) A code-driven sandbox route (`/_spike/parts`) renders one builder under gameplay lighting and exports it to `.glb` via `GLTFExporter`. (3) `Vessel.tsx` loads committed `.glb` assets with drei `useGLTF`, keyed off `meshId`, falling back to today's primitive. The engine plume becomes a textured cone anchored at the nozzle exit.

**Tech Stack:** TypeScript, React Three Fiber, Three.js (`three/webgpu` renderer + `three/examples/jsm/exporters/GLTFExporter.js`), `@react-three/drei` (`useGLTF`, `OrbitControls`), Vitest.

## Global Constraints

- **No new dependencies.** `GLTFExporter` ships with `three`; `useGLTF`/`OrbitControls` ship with `@react-three/drei`. Both already installed.
- **Geometry convention (every builder):** authored in **metres**; origin at the **part origin**; long axis on **local +Z**, geometry centered so it spans roughly `±length/2` on Z; for engine parts the **nozzle exit is at the −Z end**. (This is exactly the frame `Vessel.tsx` places parts in, so baked meshes drop in with no runtime rotation/offset.)
- **Builders are pure and deterministic** — same params → same geometry, no randomness that varies between runs.
- Tests run under Vitest in the **node** environment (no jsdom). Builders return THREE core objects (`Group`/`Mesh`/`BufferGeometry`/`MeshStandardMaterial`), all of which construct headless; assert geometry with `new Box3().setFromObject(group)`. Do **not** unit-test anything needing a GL context, `document`, or `useGLTF` — those are verified by driving the app.
- Match repo conventions: tests in `__tests__/` dirs, no semicolons in `src/render`/`src/sim` style (follow the file you touch), `npm run check` (`typecheck && lint && test`) must pass at the end.
- Spec: `docs/superpowers/specs/2026-07-06-vehicle-part-meshes-design.md`.

---

### Task 1: Stage-body builder + shared materials

**Files:**
- Create: `src/spike/parts/materials.ts`
- Create: `src/spike/parts/tankBuilder.ts`
- Test: `src/spike/parts/__tests__/tankBuilder.test.ts`

**Interfaces:**
- Produces: `buildStageBody(params: StageBodyParams): Group` where `StageBodyParams = { radius: number; length: number; color?: string; ribs?: number }`.
- Produces (materials): `brushedMetal(color?): MeshStandardMaterial`, `paintedBand(color?)`, `heatShield(color?)`, `nozzleMetal(color?)`.

- [ ] **Step 1: Write the failing test**

```ts
// src/spike/parts/__tests__/tankBuilder.test.ts
import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { buildStageBody } from '../tankBuilder'

describe('buildStageBody', () => {
  it('is centered on the origin with its long axis on +Z', () => {
    const box = new Box3().setFromObject(buildStageBody({ radius: 2, length: 12 }))
    expect(box.min.z).toBeCloseTo(-6, 3)
    expect(box.max.z).toBeCloseTo(6, 3)
    // radius (no ribs) ≈ 2 in x and y
    expect(box.max.x).toBeCloseTo(2, 1)
    expect(box.max.y).toBeCloseTo(2, 1)
  })

  it('adds one rib mesh per requested rib ring', () => {
    const plain = buildStageBody({ radius: 2, length: 12, ribs: 0 })
    const ribbed = buildStageBody({ radius: 2, length: 12, ribs: 5 })
    expect(ribbed.children.length).toBe(plain.children.length + 5)
  })

  it('is deterministic for identical params', () => {
    const a = new Box3().setFromObject(buildStageBody({ radius: 1.6, length: 8, ribs: 4 }))
    const b = new Box3().setFromObject(buildStageBody({ radius: 1.6, length: 8, ribs: 4 }))
    expect(a.min.toArray()).toEqual(b.min.toArray())
    expect(a.max.toArray()).toEqual(b.max.toArray())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/spike/parts/__tests__/tankBuilder.test.ts`
Expected: FAIL — cannot find module `../tankBuilder` / `buildStageBody is not a function`.

- [ ] **Step 3: Write the materials module**

```ts
// src/spike/parts/materials.ts
import { MeshStandardMaterial } from 'three'

export function brushedMetal(color = '#b8bcc4'): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, metalness: 0.85, roughness: 0.42 })
}
export function paintedBand(color = '#d8dce4'): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 })
}
export function heatShield(color = '#5a4632'): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.9 })
}
export function nozzleMetal(color = '#3a3a3e'): MeshStandardMaterial {
  return new MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.35 })
}
```

- [ ] **Step 4: Write the stage-body builder**

```ts
// src/spike/parts/tankBuilder.ts
import { CylinderGeometry, Group, Mesh, TorusGeometry } from 'three'
import { brushedMetal } from './materials'

export interface StageBodyParams {
  radius: number
  length: number
  color?: string
  /** Number of evenly spaced rib rings around the body. */
  ribs?: number
}

/**
 * A stage body (tank + skin) centered at the origin, long axis on +Z, spanning
 * ±length/2. Built along Y then rotated so the length runs on Z (matching the
 * part-frame convention Vessel.tsx renders in). Ribs are thin torus rings whose
 * hole axis is already Z.
 */
export function buildStageBody(params: StageBodyParams): Group {
  const { radius, length, color, ribs = 0 } = params
  const group = new Group()
  const skin = brushedMetal(color)

  const body = new CylinderGeometry(radius, radius, length, 32, 1)
  body.rotateX(Math.PI / 2) // Y-length → Z-length
  group.add(new Mesh(body, skin))

  for (let i = 0; i < ribs; i++) {
    const z = -length / 2 + (length * (i + 1)) / (ribs + 1)
    const ring = new TorusGeometry(radius * 1.01, radius * 0.03, 8, 32)
    const rib = new Mesh(ring, skin)
    rib.position.set(0, 0, z)
    group.add(rib)
  }
  return group
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/spike/parts/__tests__/tankBuilder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/spike/parts/materials.ts src/spike/parts/tankBuilder.ts src/spike/parts/__tests__/tankBuilder.test.ts
git commit -m "feat(parts): procedural stage-body builder + shared PBR materials"
```

---

### Task 2: Bell-nozzle builder

**Files:**
- Create: `src/spike/parts/nozzleBuilder.ts`
- Test: `src/spike/parts/__tests__/nozzleBuilder.test.ts`

**Interfaces:**
- Consumes: `nozzleMetal` from `./materials`.
- Produces: `buildBellNozzle(params: BellNozzleParams): Group` where `BellNozzleParams = { throatRadius: number; exitRadius: number; length: number; color?: string }`. Throat at `z = 0`, exit (wide, open mouth) at `z = -length`.

- [ ] **Step 1: Write the failing test**

```ts
// src/spike/parts/__tests__/nozzleBuilder.test.ts
import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { buildBellNozzle } from '../nozzleBuilder'

describe('buildBellNozzle', () => {
  it('runs from throat at z=0 to exit at z=-length', () => {
    const box = new Box3().setFromObject(buildBellNozzle({ throatRadius: 0.5, exitRadius: 1.4, length: 2.4 }))
    expect(box.max.z).toBeCloseTo(0, 3)
    expect(box.min.z).toBeCloseTo(-2.4, 3)
  })

  it('is widest at the exit radius', () => {
    const box = new Box3().setFromObject(buildBellNozzle({ throatRadius: 0.5, exitRadius: 1.4, length: 2.4 }))
    expect(box.max.x).toBeCloseTo(1.4, 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/spike/parts/__tests__/nozzleBuilder.test.ts`
Expected: FAIL — cannot find module `../nozzleBuilder`.

- [ ] **Step 3: Write the implementation**

```ts
// src/spike/parts/nozzleBuilder.ts
import { Group, LatheGeometry, Mesh, Vector2 } from 'three'
import { nozzleMetal } from './materials'

export interface BellNozzleParams {
  throatRadius: number
  exitRadius: number
  length: number
  color?: string
}

/**
 * A bell nozzle: throat (narrow) at z=0, exit (wide, open mouth) at z=-length,
 * opening toward -Z (the vehicle's wake). Profile is revolved about Y from
 * throat (y=0) to exit (y=-length), then rotated so the axis runs on Z.
 * If the bell renders inside-out, reverse the point order or set the material
 * to DoubleSide.
 */
export function buildBellNozzle(params: BellNozzleParams): Group {
  const { throatRadius, exitRadius, length, color } = params
  const steps = 12
  const points: Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const r = throatRadius + (exitRadius - throatRadius) * Math.pow(t, 1.6)
    points.push(new Vector2(r, -t * length))
  }
  const geom = new LatheGeometry(points, 32)
  geom.rotateX(Math.PI / 2) // throat at z=0, exit at z=-length
  const group = new Group()
  group.add(new Mesh(geom, nozzleMetal(color)))
  return group
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/spike/parts/__tests__/nozzleBuilder.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/spike/parts/nozzleBuilder.ts src/spike/parts/__tests__/nozzleBuilder.test.ts
git commit -m "feat(parts): procedural bell-nozzle builder"
```

---

### Task 3: Capsule builder

**Files:**
- Create: `src/spike/parts/capsuleBuilder.ts`
- Test: `src/spike/parts/__tests__/capsuleBuilder.test.ts`

**Interfaces:**
- Consumes: `paintedBand`, `heatShield` from `./materials`.
- Produces: `buildCapsule(params: CapsuleParams): Group` where `CapsuleParams = { radius: number; length: number; color?: string }`. Wide heat-shield base at −Z, tapered nose at +Z, centered on the origin.

- [ ] **Step 1: Write the failing test**

```ts
// src/spike/parts/__tests__/capsuleBuilder.test.ts
import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { buildCapsule } from '../capsuleBuilder'

describe('buildCapsule', () => {
  it('is centered on the origin with base at -Z and nose at +Z', () => {
    const box = new Box3().setFromObject(buildCapsule({ radius: 1.6, length: 4 }))
    expect(box.min.z).toBeCloseTo(-2, 2)
    expect(box.max.z).toBeCloseTo(2, 2)
  })

  it('is widest near the base radius', () => {
    const box = new Box3().setFromObject(buildCapsule({ radius: 1.6, length: 4 }))
    expect(box.max.x).toBeCloseTo(1.6, 1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/spike/parts/__tests__/capsuleBuilder.test.ts`
Expected: FAIL — cannot find module `../capsuleBuilder`.

- [ ] **Step 3: Write the implementation**

```ts
// src/spike/parts/capsuleBuilder.ts
import { CircleGeometry, Group, LatheGeometry, Mesh, Vector2 } from 'three'
import { heatShield, paintedBand } from './materials'

export interface CapsuleParams {
  radius: number
  length: number
  color?: string
}

/**
 * A gumdrop capsule centered on the origin, long axis +Z, spanning ±length/2.
 * Wide base at -Z (with a heat-shield disc), tapered nose at +Z.
 */
export function buildCapsule(params: CapsuleParams): Group {
  const { radius, length, color } = params
  const steps = 16
  const points: Vector2[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps // 0 = base, 1 = nose
    const y = -length / 2 + t * length
    const r = radius * Math.cos((t * Math.PI) / 2) // radius at base → ~0 at nose
    points.push(new Vector2(Math.max(r, 0.02), y))
  }
  const shell = new LatheGeometry(points, 32)
  shell.rotateX(Math.PI / 2) // base at -Z, nose at +Z
  const group = new Group()
  group.add(new Mesh(shell, paintedBand(color)))

  const disc = new CircleGeometry(radius, 32)
  disc.rotateY(Math.PI) // face -Z
  const base = new Mesh(disc, heatShield())
  base.position.set(0, 0, -length / 2)
  group.add(base)
  return group
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/spike/parts/__tests__/capsuleBuilder.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/spike/parts/capsuleBuilder.ts src/spike/parts/__tests__/capsuleBuilder.test.ts
git commit -m "feat(parts): procedural capsule builder with heat-shield base"
```

---

### Task 4: Part assemblies (the three baked craft parts)

**Files:**
- Create: `src/spike/parts/assemblies.ts`
- Test: `src/spike/parts/__tests__/assemblies.test.ts`

**Interfaces:**
- Consumes: `buildStageBody`, `buildBellNozzle`, `buildCapsule`.
- Produces: `PART_BUILDERS: Record<'booster' | 'upper' | 'capsule', () => Group>`. Dimensions match `two-stage-ascent.json` render hints: booster r2/l12, upper r1.6/l8, capsule r1.6/l4. Engine stages carry a nozzle at the −Z (aft) end.

- [ ] **Step 1: Write the failing test**

```ts
// src/spike/parts/__tests__/assemblies.test.ts
import { describe, expect, it } from 'vitest'
import { Box3 } from 'three'
import { PART_BUILDERS } from '../assemblies'

describe('PART_BUILDERS', () => {
  it('provides the three two-stage-ascent parts', () => {
    expect(Object.keys(PART_BUILDERS).sort()).toEqual(['booster', 'capsule', 'upper'])
  })

  it('booster body radius ≈ 2 and its nozzle extends past the aft face (z < -6)', () => {
    const box = new Box3().setFromObject(PART_BUILDERS.booster())
    expect(box.max.x).toBeCloseTo(2, 0)
    expect(box.min.z).toBeLessThan(-6) // nozzle bell hangs below the -length/2 = -6 face
  })

  it('capsule spans ±2 on Z with radius ≈ 1.6', () => {
    const box = new Box3().setFromObject(PART_BUILDERS.capsule())
    expect(box.max.z).toBeCloseTo(2, 1)
    expect(box.max.x).toBeCloseTo(1.6, 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/spike/parts/__tests__/assemblies.test.ts`
Expected: FAIL — cannot find module `../assemblies`.

- [ ] **Step 3: Write the implementation**

```ts
// src/spike/parts/assemblies.ts
import { Group } from 'three'
import { buildStageBody } from './tankBuilder'
import { buildBellNozzle } from './nozzleBuilder'
import { buildCapsule } from './capsuleBuilder'

/** A stage: tank body + a bell nozzle mounted at the -Z (aft) end. */
function buildStage(radius: number, length: number, color: string, ribs: number): Group {
  const group = new Group()
  group.add(buildStageBody({ radius, length, color, ribs }))
  const nozzle = buildBellNozzle({
    throatRadius: radius * 0.25,
    exitRadius: radius * 0.7,
    length: radius * 1.2,
  })
  nozzle.position.set(0, 0, -length / 2) // throat at the aft face; bell opens further -Z
  group.add(nozzle)
  return group
}

export const PART_BUILDERS: Record<'booster' | 'upper' | 'capsule', () => Group> = {
  booster: () => buildStage(2, 12, '#b8bcc4', 7),
  upper: () => buildStage(1.6, 8, '#d8dce4', 4),
  capsule: () => buildCapsule({ radius: 1.6, length: 4, color: '#e8b060' }),
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/spike/parts/__tests__/assemblies.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/spike/parts/assemblies.ts src/spike/parts/__tests__/assemblies.test.ts
git commit -m "feat(parts): assemble booster/upper/capsule from builders"
```

---

### Task 5: Runtime mesh selector

**Files:**
- Create: `src/render/partMesh.ts`
- Test: `src/render/__tests__/partMesh.test.ts`

**Interfaces:**
- Produces: `PART_MESH_BASE = '/models/parts/'`; `partMeshUrl(meshId: string): string`; `usesBakedMesh(def: { meshId?: string }): boolean`. Used by `Vessel.tsx` (Task 8) to choose baked mesh vs primitive.

- [ ] **Step 1: Write the failing test**

```ts
// src/render/__tests__/partMesh.test.ts
import { describe, expect, it } from 'vitest'
import { partMeshUrl, usesBakedMesh } from '../partMesh'

describe('partMesh', () => {
  it('builds the public asset url for a mesh id', () => {
    expect(partMeshUrl('booster')).toBe('/models/parts/booster.glb')
  })

  it('uses a baked mesh only when meshId is a non-empty string', () => {
    expect(usesBakedMesh({ meshId: 'booster' })).toBe(true)
    expect(usesBakedMesh({})).toBe(false)
    expect(usesBakedMesh({ meshId: '' })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/render/__tests__/partMesh.test.ts`
Expected: FAIL — cannot find module `../partMesh`.

- [ ] **Step 3: Write the implementation**

```ts
// src/render/partMesh.ts
export const PART_MESH_BASE = '/models/parts/'

export function partMeshUrl(meshId: string): string {
  return `${PART_MESH_BASE}${meshId}.glb`
}

export function usesBakedMesh(def: { meshId?: string }): boolean {
  return typeof def.meshId === 'string' && def.meshId.length > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/render/__tests__/partMesh.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/render/partMesh.ts src/render/__tests__/partMesh.test.ts
git commit -m "feat(render): pure meshId→url + baked-mesh selector helpers"
```

---

### Task 6: Parts sandbox route + GLB export

**Files:**
- Create: `src/spike/parts/exportGlb.ts`
- Create: `src/spike/PartsSandbox.tsx`
- Modify: `src/appRoutes.ts` (add `spikePartsPath` + a `mainMenuLinks` entry)
- Modify: `src/App.tsx` (lazy import + `<Route>`)

**Interfaces:**
- Consumes: `PART_BUILDERS` (Task 4), `makeWebGPURenderer` (`src/render/webgpuRenderer.ts`).
- Produces: route `/_spike/parts`; `exportGroupToGlb(object: Object3D, filename: string): Promise<void>`; component `PartsSandboxPage`.

This task is verified by driving the app (WebGPU + browser download can't run in node). No unit test.

- [ ] **Step 1: Write the export helper**

```ts
// src/spike/parts/exportGlb.ts
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import type { Object3D } from 'three'

/** Export a THREE object to a binary .glb and trigger a browser download. */
export async function exportGroupToGlb(object: Object3D, filename: string): Promise<void> {
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(object, { binary: true })
  const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.glb') ? filename : `${filename}.glb`
  a.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 2: Write the sandbox page**

```tsx
// src/spike/PartsSandbox.tsx
import { useMemo, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { makeWebGPURenderer } from '../render/webgpuRenderer'
import { PART_BUILDERS } from './parts/assemblies'
import { exportGroupToGlb } from './parts/exportGlb'

// Which part to sculpt. Change this + save — HMR shows it live.
const PART: keyof typeof PART_BUILDERS = 'booster'

export function PartsSandboxPage() {
  const object = useMemo(() => PART_BUILDERS[PART](), [])
  const [status, setStatus] = useState('')

  async function onExport() {
    setStatus('exporting…')
    await exportGroupToGlb(object, PART)
    setStatus(`downloaded ${PART}.glb`)
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#15171c' }}>
      <Canvas camera={{ position: [6, 4, 8], near: 0.01, far: 100, fov: 45 }} gl={makeWebGPURenderer()}>
        <directionalLight position={[5, 8, 5]} intensity={3} />
        <ambientLight intensity={0.15} />
        <gridHelper args={[20, 20, '#444', '#222']} />
        <primitive object={object} />
        <OrbitControls />
      </Canvas>
      <div style={{ position: 'absolute', top: 12, left: 12, color: '#cfe', fontFamily: 'monospace' }}>
        <div>PART: {PART}</div>
        <button
          onClick={() => void onExport()}
          style={{ marginTop: 8, padding: '8px 14px', cursor: 'pointer' }}
        >
          Export GLB
        </button>
        <div style={{ marginTop: 6, opacity: 0.7 }}>{status}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Register the route in `src/appRoutes.ts`**

Add after the existing `spikeAtmospherePath` line:

```ts
export const spikePartsPath = '/_spike/parts';
```

And add to the `mainMenuLinks` array:

```ts
  { label: 'Parts Sandbox', path: spikePartsPath },
```

- [ ] **Step 4: Wire the route in `src/App.tsx`**

Add `spikePartsPath` to the existing `appRoutes` import. Add a lazy import beside the other spikes:

```tsx
const PartsSandboxPage = lazy(() => import('./spike/PartsSandbox').then((m) => ({ default: m.PartsSandboxPage })));
```

Add a `<Route>` beside the other spike routes:

```tsx
      <Route
        path={spikePartsPath}
        element={
          <Suspense
            fallback={
              <div style={{ position: 'absolute', inset: 0, background: '#000', color: '#888', padding: 16 }}>
                LOADING PARTS SANDBOX
              </div>
            }
          >
            <PartsSandboxPage />
          </Suspense>
        }
      />
```

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npx eslint src/spike/PartsSandbox.tsx src/spike/parts/exportGlb.ts src/appRoutes.ts src/App.tsx`
Expected: no errors.

- [ ] **Step 6: Drive the sandbox to verify**

Run: `npm run dev`, open `http://localhost:5173/_spike/parts`.
Expected: the booster renders as a ribbed metal body with a bell nozzle at the bottom, lit and orbit-controllable on a grid. Click **Export GLB** → `booster.glb` downloads and status reads "downloaded booster.glb".
If the nozzle looks inside-out, set `nozzleMetal`'s material `side` to `DoubleSide` (import `DoubleSide` in `materials.ts`) and re-verify.

- [ ] **Step 7: Commit**

```bash
git add src/spike/PartsSandbox.tsx src/spike/parts/exportGlb.ts src/appRoutes.ts src/App.tsx
git commit -m "feat(spike): /_spike/parts sandbox with GLB export"
```

---

### Task 7: Bake the three GLB assets

**Files:**
- Create: `public/models/parts/booster.glb`
- Create: `public/models/parts/upper.glb`
- Create: `public/models/parts/capsule.glb`

Content-authoring task: run the sandbox and export each part. No code, no unit test.

- [ ] **Step 1: Make the asset directory**

```bash
mkdir -p public/models/parts
```

- [ ] **Step 2: Export each part**

With `npm run dev` running and `http://localhost:5173/_spike/parts` open: for each of `booster`, `upper`, `capsule`, set `const PART = '<id>'` at the top of `src/spike/PartsSandbox.tsx`, save (HMR reloads), eyeball the part, click **Export GLB**, and move the downloaded `<id>.glb` into `public/models/parts/`.

```bash
mv ~/Downloads/booster.glb public/models/parts/booster.glb
mv ~/Downloads/upper.glb   public/models/parts/upper.glb
mv ~/Downloads/capsule.glb public/models/parts/capsule.glb
```

- [ ] **Step 3: Sanity-check the files exist and are non-empty**

Run: `ls -l public/models/parts/`
Expected: three `.glb` files, each > 0 bytes.

- [ ] **Step 4: Reset `PART` and commit**

Set `const PART = 'booster'` back in `src/spike/PartsSandbox.tsx`.

```bash
git add public/models/parts/*.glb src/spike/PartsSandbox.tsx
git commit -m "assets(parts): baked booster/upper/capsule meshes"
```

---

### Task 8: Load baked meshes in Vessel + wire the scenario

**Files:**
- Modify: `src/render/Vessel.tsx`
- Modify: `public/data/scenarios/two-stage-ascent.json`

**Interfaces:**
- Consumes: `partMeshUrl`, `usesBakedMesh` (Task 5); the baked assets (Task 7).

Verified by driving the mission (loading `.glb` needs a GL context). No unit test — the selection logic it relies on is already covered by Task 5.

- [ ] **Step 1: Add the `BakedPart` component and `meshId` to `PlacedPart` in `src/render/Vessel.tsx`**

Add imports near the top:

```tsx
import { useGLTF } from '@react-three/drei'
import { partMeshUrl, usesBakedMesh } from './partMesh'
```

Add `meshId` to the `PlacedPart` interface:

```tsx
interface PlacedPart {
  instanceId: string
  position: Vec3
  quaternion: [number, number, number, number]
  render: PartRender
  meshId?: string
  engine?: { direction: Vec3, stage: number, nozzleZ: number }
}
```

Set it in the `placed` mapping (where the object literal is returned, alongside `render`):

```tsx
        return {
          instanceId: p.instanceId,
          position: t.position,
          quaternion: quaternionFromMat3(t.rotation),
          render,
          meshId: def.meshId,
          engine: engineMod && engineMod.kind === 'engine'
            ? {
                direction: mat3MulVec(t.rotation, normalize(engineMod.thrustDirection ?? [0, 0, 1])),
                stage: p.stage,
                nozzleZ: -(render.length ?? 4) / 2 - 1,
              }
            : undefined,
        }
```

Add the `BakedPart` component near `PartShape`:

```tsx
/** A baked .glb part loaded by meshId. Materials travel with the asset. */
function BakedPart({ meshId }: { meshId: string }) {
  const { scene } = useGLTF(partMeshUrl(meshId))
  const object = useMemo(() => scene.clone(true), [scene])
  return <primitive object={object} />
}
```

- [ ] **Step 2: Choose baked vs primitive in the render**

Replace the existing `<PartShape render={p.render} />` line with:

```tsx
            {usesBakedMesh(p) ? <BakedPart meshId={p.meshId!} /> : <PartShape render={p.render} />}
```

- [ ] **Step 3: Set `meshId` on the scenario part defs**

In `public/data/scenarios/two-stage-ascent.json`, add a `"meshId"` to each `partDefs` entry (sibling of `"dryMass"`):

```json
["booster", { "id": "booster", "meshId": "booster", "dryMass": 5000, ... }],
["upper",   { "id": "upper",   "meshId": "upper",   "dryMass": 2000, ... }],
["capsule", { "id": "capsule", "meshId": "capsule", "dryMass": 1000, ... }]
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npx eslint src/render/Vessel.tsx`
Expected: no errors.

- [ ] **Step 5: Drive the mission to verify**

Run: `npm run dev`, open `http://localhost:5173/mission/two-stage-ascent`.
Expected: the craft renders booster + upper + capsule as the baked meshes (metal bodies, bell nozzles, gold capsule), correctly stacked and scaled, sitting on the pad. Staging (spacebar) drops the booster and the upper's mesh remains. A part with no `meshId` would still show the old primitive (regression check: none should here).

- [ ] **Step 6: Commit**

```bash
git add src/render/Vessel.tsx public/data/scenarios/two-stage-ascent.json
git commit -m "feat(render): load baked part meshes via meshId, primitive fallback"
```

---

### Task 9: Textured conic plume

**Files:**
- Create: `src/render/plume.ts`
- Modify: `src/render/Vessel.tsx`

**Interfaces:**
- Produces: `createPlumeTexture(): CanvasTexture` (browser-only). Replaces the sphere flame with a cone anchored at the nozzle exit, gated by the existing throttle/stage logic.

Browser-only (canvas + GL). Verified by driving the mission.

- [ ] **Step 1: Write the plume texture helper**

```ts
// src/render/plume.ts
import { CanvasTexture } from 'three'

/** A vertical gradient: hot white at the nozzle → orange → transparent downstream. */
export function createPlumeTexture(): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createLinearGradient(0, 0, 0, 64)
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)')
  gradient.addColorStop(0.3, 'rgba(255,180,80,0.7)')
  gradient.addColorStop(1, 'rgba(255,120,40,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 16, 64)
  return new CanvasTexture(canvas)
}
```

- [ ] **Step 2: Use it in `src/render/Vessel.tsx`**

Add imports:

```tsx
import { AdditiveBlending, DoubleSide } from 'three'
import { createPlumeTexture } from './plume'
```

Create one shared texture at module scope (below the imports):

```tsx
const PLUME_TEXTURE = createPlumeTexture()
```

Replace the engine flame `<mesh>…</mesh>` block (the `sphereGeometry` + `meshBasicMaterial`) with a cone anchored at the nozzle exit, opening downstream (−Z). `PLUME_LENGTH` and the exit radius approximate the baked bell:

```tsx
            {p.engine && (() => {
              const exitR = (p.render.radius ?? 1.5) * 0.7
              const plumeLen = (p.render.radius ?? 1.5) * 3
              return (
                <mesh
                  ref={(m) => {
                    if (m) flames.current.set(p.instanceId, { mesh: m, stage: p.engine!.stage })
                    else flames.current.delete(p.instanceId)
                  }}
                  position={[0, 0, p.engine.nozzleZ - plumeLen / 2]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  visible={false}
                >
                  <coneGeometry args={[exitR, plumeLen, 20, 1, true]} />
                  <meshBasicMaterial
                    map={PLUME_TEXTURE}
                    color="#ffd0a0"
                    transparent
                    depthWrite={false}
                    blending={AdditiveBlending}
                    side={DoubleSide}
                  />
                </mesh>
              )
            })()}
```

(The `flames` map, the `useFrame` visibility gating — `f.mesh.visible = lit && f.stage === stage` — and `nozzleZ` are unchanged, so the plume still fires only on the active stage at throttle.)

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npx eslint src/render/Vessel.tsx src/render/plume.ts`
Expected: no errors.

- [ ] **Step 4: Drive the mission to verify**

Run: `npm run dev`, open `http://localhost:5173/mission/two-stage-ascent`, throttle up (`Shift`).
Expected: a soft glowing cone extends from the firing stage's nozzle into the wake, not a sphere; it disappears at zero throttle and follows the active stage after staging.

- [ ] **Step 5: Commit**

```bash
git add src/render/plume.ts src/render/Vessel.tsx
git commit -m "feat(render): textured conic engine plume anchored at the nozzle exit"
```

---

### Task 10: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full check suite**

Run: `npm run check`
Expected: typecheck, lint, and all tests pass (includes the new builder + selector tests).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds (confirms the `GLTFExporter` import and lazy sandbox route bundle cleanly).

- [ ] **Step 3: Final visual pass**

Run: `npm run dev`.
- `/_spike/parts` — each of booster/upper/capsule reads as believable hardware under lighting.
- `/mission/two-stage-ascent` — the assembled craft looks like a rocket, stacks/scales correctly, stages cleanly, and the conic plume fires on the active stage.

- [ ] **Step 4: Confirm success criteria (spec §Success criteria)**

- [ ] Craft renders baked procedural meshes with PBR materials and looks like a rocket.
- [ ] No geometry generated at load time in gameplay (assets load from `public/models/parts/`).
- [ ] Parts without a `meshId` still fall back to `PartShape`.
- [ ] Plume is a textured cone at the nozzle exit, firing on the active stage at throttle.
- [ ] `npm run check` and `npm run build` pass.

---

## Graduation path (why the boundaries are drawn this way)

This sandbox is the most likely of the spikes to become a permanent feature (in-game
custom-parts authoring). The design keeps the **durable core** — the pure, tested,
React-free geometry builders (`src/spike/parts/*Builder.ts`, `materials.ts`,
`assemblies.ts`) and the runtime selector (`src/render/partMesh.ts`) — separate from
the **disposable shell** (`PartsSandbox.tsx` + its route). When authoring graduates:
the builders/selector move to `src/render/parts/` unchanged, `assemblies.ts` becomes a
data-driven catalog, and only the page/route is rewritten into real UI. Nothing in the
durable core assumes it lives in `src/spike/`, so the move is a relocation, not a
rewrite. Keep builders framework-agnostic (plain THREE in, `Group` out) to preserve this.

## Self-Review notes (for the executor)

- **Spec coverage:** sandbox (Task 6) · builders/materials (1–4) · bake→GLB (6–7) · runtime load via `meshId` + primitive fallback (5, 8) · metres/+Z/origin convention (Global Constraints + builder tests) · plume upgrade (9) · testing (unit for builders + selector; manual for the rest, Tasks 6/8/9/10). No new deps.
- **Known verify-time risks (from the spec's "assumptions"):** (a) a cloned `useGLTF` scene rendering on the vehicle layer through the multi-pass pipeline — check in Task 8 step 5; the existing `setLayerRecursively` walks children each frame. (b) `GLTFExporter` round-trip preserving materials/scale — check in Task 6/8. (c) baked PBR reading true under the vehicle view's tone-mapping — the sandbox uses the same `makeWebGPURenderer`, so what you see when baking matches gameplay.
- If a cloned GLTF does **not** pick up the vehicle layer, set layers explicitly inside `BakedPart` via a small `useEffect` that walks `object` and calls `child.layers.set(RENDER_LAYERS.vehicle)` (import `RENDER_LAYERS` from `./renderLayers`).
