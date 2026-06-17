import { describe, expect, it } from 'vitest'
import {
  aggregate,
  buildSkeleton,
  netThrust,
  resolvePartTransforms,
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
