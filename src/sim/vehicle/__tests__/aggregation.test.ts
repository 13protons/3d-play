import { describe, expect, it } from 'vitest'
import {
  aggregate,
  buildSkeleton,
  deflectDirection,
  effectiveIsp,
  effectiveThrust,
  netThrust,
  netThrustGimbaled,
  resolvePartTransforms,
  solveGimbalForTorque,
  type EngineTerm,
} from '../aggregation'
import type { PartDefinition } from '../parts'
import { MAT3_ZERO, type Mat3, type Quaternion, type Vec3 } from '../mat3'
import type { PartInstance } from '../../types'

const IDENTITY_Q: Quaternion = [0, 0, 0, 1]

function part(overrides: Partial<PartInstance> & Pick<PartInstance, 'instanceId' | 'defId'>): PartInstance {
  return {
    parentInstanceId: null,
    parentAttachPointId: null,
    myAttachPointId: 'top',
    localPosition: [0, 0, 0],
    localRotation: IDENTITY_Q,
    stage: 0,
    active: true,
    ...overrides,
  }
}

function defs(...entries: PartDefinition[]): Map<string, PartDefinition> {
  return new Map(entries.map((d) => [d.id, d]))
}

function expectVec3Close(actual: Vec3, expected: Vec3, digits = 9): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], digits)
}

function expectMat3Close(actual: Mat3, expected: Mat3, digits = 9): void {
  for (let i = 0; i < 9; i++) expect(actual[i]).toBeCloseTo(expected[i], digits)
}

describe('resolvePartTransforms', () => {
  it('places a child relative to a rotated parent', () => {
    // Parent rotated 90° about +Z; child mounted at local +X ends up at +Y.
    const parts = [
      part({ instanceId: 'root', defId: 'a', localRotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }),
      part({ instanceId: 'child', defId: 'a', parentInstanceId: 'root', localPosition: [1, 0, 0] }),
    ]
    const transforms = resolvePartTransforms(parts)
    expectVec3Close(transforms.get('child')!.position, [0, 1, 0])
  })

  it('resolves regardless of input order (child before parent)', () => {
    const parts = [
      part({ instanceId: 'child', defId: 'a', parentInstanceId: 'root', localPosition: [0, 0, 2] }),
      part({ instanceId: 'root', defId: 'a', localPosition: [0, 0, 5] }),
    ]
    const transforms = resolvePartTransforms(parts)
    expectVec3Close(transforms.get('child')!.position, [0, 0, 7])
  })
})

describe('buildSkeleton + aggregate', () => {
  it('a single part at the origin reproduces its own mass and inertia', () => {
    const inertia: Mat3 = [10, 0, 0, 0, 10, 0, 0, 0, 5]
    const skeleton = buildSkeleton(
      [part({ instanceId: 'p', defId: 'core' })],
      defs({ id: 'core', dryMass: 1000, inertia, modules: [] }),
    )
    const agg = aggregate(skeleton, new Map())
    expect(agg.mass).toBe(1000)
    expectVec3Close(agg.centerOfMass, [0, 0, 0])
    expectMat3Close(agg.inertia, inertia)
  })

  it('two symmetric point masses give zero CoM and the parallel-axis inertia', () => {
    // Massless-inertia parts at ±2 on X, 500 kg each. About the CoM (origin):
    // each contributes 500·diag(0,4,4) → total diag(0, 4000, 4000).
    const skeleton = buildSkeleton(
      [
        part({ instanceId: 'l', defId: 'pt', localPosition: [-2, 0, 0] }),
        part({ instanceId: 'r', defId: 'pt', localPosition: [2, 0, 0] }),
      ],
      defs({ id: 'pt', dryMass: 500, inertia: MAT3_ZERO, modules: [] }),
    )
    const agg = aggregate(skeleton, new Map())
    expect(agg.mass).toBe(1000)
    expectVec3Close(agg.centerOfMass, [0, 0, 0])
    expectMat3Close(agg.inertia, [0, 0, 0, 0, 4000, 0, 0, 0, 4000])
  })

  it('fuel shifts the CoM toward the tank and adds mass', () => {
    const skeleton = buildSkeleton(
      [
        part({ instanceId: 'core', defId: 'dry' }),
        part({ instanceId: 'tank', defId: 'tank', localPosition: [0, 0, 4] }),
      ],
      defs(
        { id: 'dry', dryMass: 1000, inertia: MAT3_ZERO, modules: [] },
        { id: 'tank', dryMass: 0, inertia: MAT3_ZERO, modules: [{ kind: 'tank', capacity: 1000 }] },
      ),
    )
    const empty = aggregate(skeleton, new Map())
    expectVec3Close(empty.centerOfMass, [0, 0, 0])
    expect(empty.mass).toBe(1000)

    const full = aggregate(skeleton, new Map([['tank', 1000]]))
    expect(full.mass).toBe(2000)
    // CoM = (1000·0 + 1000·4) / 2000 = 2 along +Z.
    expectVec3Close(full.centerOfMass, [0, 0, 2])
  })

  it('excludes inactive (jettisoned) parts', () => {
    const skeleton = buildSkeleton(
      [
        part({ instanceId: 'keep', defId: 'm', localPosition: [0, 0, 0] }),
        part({ instanceId: 'drop', defId: 'm', localPosition: [0, 0, 10], active: false }),
      ],
      defs({ id: 'm', dryMass: 300, inertia: MAT3_ZERO, modules: [] }),
    )
    const agg = aggregate(skeleton, new Map())
    expect(agg.mass).toBe(300)
    expectVec3Close(agg.centerOfMass, [0, 0, 0])
  })

  it('inertia inverse is null for a degenerate single point mass', () => {
    const skeleton = buildSkeleton(
      [part({ instanceId: 'p', defId: 'pt' })],
      defs({ id: 'pt', dryMass: 100, inertia: MAT3_ZERO, modules: [] }),
    )
    expect(aggregate(skeleton, new Map()).inertiaInverse).toBeNull()
  })
})

describe('drag area + center of pressure', () => {
  it('sums active part drag areas and area-weights the center of pressure', () => {
    const skeleton = buildSkeleton(
      [
        part({ instanceId: 'aft', defId: 'big', localPosition: [0, 0, 0] }),
        part({ instanceId: 'fwd', defId: 'small', localPosition: [0, 0, 10] }),
      ],
      defs(
        { id: 'big', dryMass: 100, inertia: MAT3_ZERO, dragArea: 9, modules: [] },
        { id: 'small', dryMass: 100, inertia: MAT3_ZERO, dragArea: 1, modules: [] },
      ),
    )
    expect(skeleton.dragArea).toBe(10)
    // CoP = (9·0 + 1·10) / 10 = 1 → pulled toward the big aft area.
    expectVec3Close(skeleton.centerOfPressure, [0, 0, 1])
  })

  it('has zero area and origin CoP when no part declares drag area', () => {
    const skeleton = buildSkeleton(
      [part({ instanceId: 'p', defId: 'none' })],
      defs({ id: 'none', dryMass: 100, inertia: MAT3_ZERO, modules: [] }),
    )
    expect(skeleton.dragArea).toBe(0)
    expectVec3Close(skeleton.centerOfPressure, [0, 0, 0])
  })

  it('drag area drops when a part is inactive (jettisoned)', () => {
    const skeleton = buildSkeleton(
      [
        part({ instanceId: 'keep', defId: 'a' }),
        part({ instanceId: 'drop', defId: 'a', localPosition: [0, 0, 5], active: false }),
      ],
      defs({ id: 'a', dryMass: 100, inertia: MAT3_ZERO, dragArea: 4, modules: [] }),
    )
    expect(skeleton.dragArea).toBe(4)
  })
})

describe('skeleton engine + reaction wheel collection', () => {
  it('collects engines with body-frame direction and reaction-wheel torque', () => {
    const skeleton = buildSkeleton(
      [part({ instanceId: 'e', defId: 'engine' })],
      defs({
        id: 'engine',
        dryMass: 200,
        inertia: MAT3_ZERO,
        modules: [
          { kind: 'engine', maxThrust: 1000, isp: 300 },
          { kind: 'reactionWheel', torque: [50, 50, 20] },
        ],
      }),
    )
    expect(skeleton.engines).toHaveLength(1)
    expectVec3Close(skeleton.engines[0].direction, [0, 0, 1])
    expect(skeleton.engines[0].maxThrust).toBe(1000)
    expectVec3Close(skeleton.reactionWheelTorque, [50, 50, 20])
  })
})

describe('netThrust', () => {
  const engine = (position: Vec3, direction: Vec3): Parameters<typeof netThrust>[0][number] => ({
    instanceId: 'e',
    position,
    direction,
    maxThrust: 1000,
    isp: 300,
    stage: 0,
    gimbalRange: 0,
  })

  it('is zero at zero throttle', () => {
    const result = netThrust([engine([0, 0, 0], [0, 0, 1])], [0, 0, 0], 0)
    expectVec3Close(result.force, [0, 0, 0])
    expectVec3Close(result.torque, [0, 0, 0])
  })

  it('a centered engine produces pure axial force, no torque', () => {
    const result = netThrust([engine([0, 0, -1], [0, 0, 1])], [0, 0, 0], 1)
    expectVec3Close(result.force, [0, 0, 1000])
    expectVec3Close(result.torque, [0, 0, 0])
  })

  it('an off-axis engine produces a torque about the CoM', () => {
    // Engine offset +1 on X, thrust +Z: torque = r×F = [1,0,0]×[0,0,1000] = [0,-1000,0].
    const result = netThrust([engine([1, 0, 0], [0, 0, 1])], [0, 0, 0], 1)
    expectVec3Close(result.force, [0, 0, 1000])
    expectVec3Close(result.torque, [0, -1000, 0])
  })

  it('scales force with throttle', () => {
    const result = netThrust([engine([0, 0, 0], [0, 0, 1])], [0, 0, 0], 0.5)
    expectVec3Close(result.force, [0, 0, 500])
  })
})

describe('gimbal', () => {
  const RANGE = (10 * Math.PI) / 180
  // One engine mounted below the CoM, thrust +Z — a normal rocket layout.
  const gimbalEngine = (): EngineTerm => ({
    instanceId: 'e',
    position: [0, 0, -5],
    direction: [0, 0, 1],
    maxThrust: 1000,
    isp: 300,
    stage: 0,
    gimbalRange: RANGE,
  })

  it('deflectDirection tilts the thrust axis and preserves unit length', () => {
    const d = deflectDirection([0, 0, 1], 0.1, 0)
    expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12)
    expect(d[2]).toBeLessThan(1) // tilted off the +Z axis
    expect(d[1]).not.toBe(0)
  })

  it('zero deflection matches the un-gimbaled net thrust', () => {
    const e = [gimbalEngine()]
    const a = netThrustGimbaled(e, [0, 0, 0], 1, 0, 0)
    const b = netThrust(e, [0, 0, 0], 1)
    expectVec3Close(a.force, b.force)
    expectVec3Close(a.torque, b.torque)
  })

  it('a deflected engine imparts a torque from its mount point', () => {
    // Engine 5 m below the CoM, thrust deflected: torque grows from the arm × force.
    const result = netThrustGimbaled([gimbalEngine()], [0, 0, 0], 1, RANGE, 0)
    const torqueMag = Math.hypot(result.torque[0], result.torque[1], result.torque[2])
    expect(torqueMag).toBeGreaterThan(0)
    // Thrust magnitude is conserved (just redirected).
    expect(Math.hypot(result.force[0], result.force[1], result.force[2])).toBeCloseTo(1000, 6)
  })

  it('solveGimbalForTorque finds a deflection that produces the requested torque', () => {
    const e = [gimbalEngine()]
    // Pick a torque well within range capacity (arm 5 m, thrust 1000, sin10° ≈ 0.17 → ~868 N·m max).
    const desired = { x: 300, y: -200 }
    const { gx, gy } = solveGimbalForTorque(e, [0, 0, 0], 1, desired.x, desired.y)
    const torque = netThrustGimbaled(e, [0, 0, 0], 1, gx, gy).torque
    expect(torque[0]).toBeCloseTo(desired.x, 0)
    expect(torque[1]).toBeCloseTo(desired.y, 0)
  })

  it('clamps the deflection to the gimbal range for an over-large request', () => {
    const e = [gimbalEngine()]
    const { gx, gy } = solveGimbalForTorque(e, [0, 0, 0], 1, 1e9, 0)
    expect(Math.hypot(gx, gy)).toBeLessThanOrEqual(RANGE + 1e-9)
  })

  it('produces no deflection for a fixed (non-gimbal) engine', () => {
    const fixed: EngineTerm = { ...gimbalEngine(), gimbalRange: 0 }
    const { gx, gy } = solveGimbalForTorque([fixed], [0, 0, 0], 1, 500, 0)
    expect(gx).toBe(0)
    expect(gy).toBe(0)
  })
})

describe('atmospheric engine performance', () => {
  const atmo: EngineTerm = {
    instanceId: 'e',
    position: [0, 0, 0],
    direction: [0, 0, 1],
    maxThrust: 2000, // vacuum
    isp: 320, // vacuum
    thrustSeaLevel: 1600,
    ispSeaLevel: 280,
    stage: 0,
    gimbalRange: 0,
  }

  it('interpolates thrust and Isp between vacuum and sea level', () => {
    expect(effectiveThrust(atmo, 0)).toBe(2000) // vacuum
    expect(effectiveThrust(atmo, 1)).toBe(1600) // sea level
    expect(effectiveThrust(atmo, 0.5)).toBe(1800)
    expect(effectiveIsp(atmo, 0)).toBe(320)
    expect(effectiveIsp(atmo, 1)).toBe(280)
    expect(effectiveIsp(atmo, 0.5)).toBe(300)
  })

  it('clamps the pressure ratio to [0, 1]', () => {
    expect(effectiveThrust(atmo, 2)).toBe(1600)
    expect(effectiveThrust(atmo, -1)).toBe(2000)
  })

  it('is constant (vacuum) when no sea-level values are given', () => {
    const fixed: EngineTerm = { instanceId: 'f', position: [0, 0, 0], direction: [0, 0, 1], maxThrust: 1000, isp: 300, stage: 0, gimbalRange: 0 }
    expect(effectiveThrust(fixed, 1)).toBe(1000)
    expect(effectiveIsp(fixed, 1)).toBe(300)
  })

  it('netThrust scales force with ambient pressure', () => {
    const sea = netThrust([atmo], [0, 0, 0], 1, 1)
    expect(sea.force[2]).toBeCloseTo(1600, 6)
    const vac = netThrust([atmo], [0, 0, 0], 1, 0)
    expect(vac.force[2]).toBeCloseTo(2000, 6)
  })
})
