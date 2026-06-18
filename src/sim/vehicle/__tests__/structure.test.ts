import { describe, expect, it } from 'vitest'
import { VehicleStructure } from '../structure'
import type { PartDefinition } from '../parts'
import { MAT3_ZERO, type Vec3 } from '../mat3'
import { deltaVBudget } from '../thrust'
import type { PartInstance } from '../../types'

function part(overrides: Partial<PartInstance> & Pick<PartInstance, 'instanceId' | 'defId'>): PartInstance {
  return {
    parentInstanceId: null,
    parentAttachPointId: null,
    myAttachPointId: 'top',
    localPosition: [0, 0, 0],
    localRotation: [0, 0, 0, 1],
    stage: 0,
    active: true,
    ...overrides,
  }
}

function expectVec3Close(actual: Vec3, expected: Vec3, digits = 9): void {
  for (let i = 0; i < 3; i++) expect(actual[i]).toBeCloseTo(expected[i], digits)
}

describe('VehicleStructure.singleBody (legacy equivalence)', () => {
  const config = { dryMass: 9000, fuelMass: 141000, maxThrust: 2_100_000, isp: 350, reactionWheelTorque: [4800, 4800, 3200] as Vec3 }

  it('aggregates to dry+fuel mass at the origin with zero geometric inertia', () => {
    const s = VehicleStructure.singleBody(config)
    const agg = s.aggregate()
    expect(agg.mass).toBe(150_000)
    expectVec3Close(agg.centerOfMass, [0, 0, 0])
    // Everything at the origin → no geometric inertia (worker supplies diagonal MoI).
    for (let i = 0; i < 9; i++) expect(agg.inertia[i]).toBeCloseTo(0, 9)
  })

  it('thrust is pure +Z through the CoM (no torque), scaling with throttle', () => {
    const s = VehicleStructure.singleBody(config)
    const com = s.aggregate().centerOfMass
    const full = s.netThrustBody(1, com)
    expectVec3Close(full.force, [0, 0, 2_100_000])
    expectVec3Close(full.torque, [0, 0, 0])
    expectVec3Close(s.netThrustBody(0.5, com).force, [0, 0, 1_050_000])
  })

  it('exposes summed thrust, isp and reaction-wheel torque', () => {
    const s = VehicleStructure.singleBody(config)
    expect(s.totalMaxThrust()).toBe(2_100_000)
    expect(s.isp()).toBe(350)
    expectVec3Close(s.reactionWheelTorque, [4800, 4800, 3200])
  })

  it('reports a single stage whose ΔV matches Tsiolkovsky', () => {
    const s = VehicleStructure.singleBody(config)
    const summaries = s.stageSummaries()
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ stage: 0, wetMass: 150_000, dryMass: 9000, isp: 350 })
    expect(summaries[0].deltaV).toBeCloseTo(deltaVBudget(150_000, 9000, 350), 6)
    expect(s.totalDeltaV()).toBeCloseTo(summaries[0].deltaV, 6)
  })

  it('draining fuel lowers total fuel and aggregate mass; clamps at empty', () => {
    const s = VehicleStructure.singleBody(config)
    s.drain(1000)
    expect(s.totalFuel()).toBeCloseTo(140_000, 6)
    expect(s.aggregate().mass).toBeCloseTo(149_000, 6)
    s.drain(1e9)
    expect(s.totalFuel()).toBe(0)
    expect(s.aggregate().mass).toBe(9000)
  })
})

describe('VehicleStructure with a real tree', () => {
  const defs = new Map<string, PartDefinition>([
    ['core', { id: 'core', dryMass: 1000, inertia: MAT3_ZERO, modules: [{ kind: 'engine', maxThrust: 1000, isp: 300 }] }],
    ['tank', { id: 'tank', dryMass: 0, inertia: MAT3_ZERO, modules: [{ kind: 'tank', capacity: 2000 }] }],
  ])

  it('defaults tank fuel to capacity when the instance omits it', () => {
    const s = new VehicleStructure([part({ instanceId: 't', defId: 'tank' })], defs)
    expect(s.totalFuel()).toBe(2000)
  })

  it('honors an explicit per-instance fuel level', () => {
    const s = new VehicleStructure([part({ instanceId: 't', defId: 'tank', fuel: 500 })], defs)
    expect(s.totalFuel()).toBe(500)
  })

  it('CoM drifts toward a draining tank as fuel burns', () => {
    const s = new VehicleStructure(
      [
        part({ instanceId: 'core', defId: 'core' }),
        part({ instanceId: 'tank', defId: 'tank', localPosition: [0, 0, 4] }),
      ],
      defs,
    )
    const full = s.aggregate().centerOfMass
    s.drain(2000) // empty the tank
    const dry = s.aggregate().centerOfMass
    expect(full[2]).toBeGreaterThan(dry[2]) // CoM was pulled toward +Z, returns to core
    expectVec3Close(dry, [0, 0, 0])
  })

  it('ground clearance is the CoM height above the lowest part base (+Z up)', () => {
    const cylDefs = new Map<string, PartDefinition>([
      ['cyl', { id: 'cyl', dryMass: 1000, inertia: MAT3_ZERO, modules: [], render: { shape: 'cylinder', radius: 1, length: 4, color: '#fff' } }],
    ])
    // Two equal cylinders (length 4) stacked along +Z at z=0 and z=4 → CoM at z=2,
    // lowest base at z=0-2=-2, so clearance = 2 - (-2) = 4.
    const s = new VehicleStructure(
      [
        part({ instanceId: 'lower', defId: 'cyl' }),
        part({ instanceId: 'upper', defId: 'cyl', localPosition: [0, 0, 4] }),
      ],
      cylDefs,
    )
    expect(s.aggregate().centerOfMass[2]).toBeCloseTo(2, 9)
    expect(s.groundClearance()).toBeCloseTo(4, 9)
  })

  it('single-body point-mass craft has zero ground clearance', () => {
    expect(VehicleStructure.singleBody({ dryMass: 1000, fuelMass: 0, maxThrust: 1, isp: 1 }).groundClearance()).toBe(0)
  })

  it('an off-axis engine produces a thrust torque about the CoM', () => {
    const s = new VehicleStructure(
      [part({ instanceId: 'e', defId: 'core', localPosition: [1, 0, 0] })],
      defs,
    )
    const com = s.aggregate().centerOfMass
    const result = s.netThrustBody(1, com)
    // Engine at x=+1 (=CoM offset 0 since it's the only part... CoM at engine).
    // CoM coincides with the single part, so torque is zero — verify that.
    expectVec3Close(result.torque, [0, 0, 0])
  })

  it('fires only the current stage and advances on staging', () => {
    const stageDefs = new Map<string, PartDefinition>([
      ['booster', { id: 'booster', dryMass: 500, inertia: MAT3_ZERO, modules: [
        { kind: 'engine', maxThrust: 2000, isp: 280 },
        { kind: 'tank', capacity: 4000 },
      ] }],
      ['upper', { id: 'upper', dryMass: 200, inertia: MAT3_ZERO, modules: [
        { kind: 'engine', maxThrust: 800, isp: 340 },
        { kind: 'tank', capacity: 1500 },
      ] }],
      ['capsule', { id: 'capsule', dryMass: 100, inertia: MAT3_ZERO, modules: [] }],
    ])
    const s = new VehicleStructure([
      part({ instanceId: 'b', defId: 'booster', stage: 0 }),
      part({ instanceId: 'u', defId: 'upper', stage: 1, parentInstanceId: 'b', localPosition: [0, 0, 3] }),
      part({ instanceId: 'c', defId: 'capsule', stage: 2, parentInstanceId: 'u', localPosition: [0, 0, 5] }),
    ], stageDefs)

    // Stage 0: only the booster fires; total mass includes everything.
    expect(s.totalMaxThrust()).toBe(2000)
    expect(s.isp()).toBe(280)
    expect(s.stageFuel()).toBe(4000)
    expect(s.totalFuel()).toBe(5500)
    expect(s.aggregate().mass).toBe(500 + 200 + 100 + 5500)
    expect(s.canStage()).toBe(true)

    // Per-stage ΔV: booster sees the upper+capsule as payload; upper sees capsule.
    const summaries = s.stageSummaries()
    expect(summaries.map((x) => x.stage)).toEqual([0, 1])
    expect(summaries[0]).toMatchObject({ wetMass: 6300, dryMass: 2300, isp: 280 })
    expect(summaries[1]).toMatchObject({ wetMass: 1800, dryMass: 300, isp: 340 })
    expect(summaries[0].deltaV).toBeCloseTo(deltaVBudget(6300, 2300, 280), 6)
    expect(summaries[1].deltaV).toBeCloseTo(deltaVBudget(1800, 300, 340), 6)

    // Fire stage 0: booster jettisoned, upper now active.
    const dropped = s.stage()
    expect(dropped).toEqual(['b'])
    expect(s.currentStage).toBe(1)
    expect(s.totalMaxThrust()).toBe(800)
    expect(s.isp()).toBe(340)
    expect(s.stageFuel()).toBe(1500)
    expect(s.aggregate().mass).toBe(200 + 100 + 1500) // booster + its fuel gone
    expect(s.canStage()).toBe(true)

    // Fire stage 1: upper jettisoned, only the capsule remains (no engines).
    expect(s.stage()).toEqual(['u'])
    expect(s.currentStage).toBe(2)
    expect(s.totalMaxThrust()).toBe(0)
    expect(s.aggregate().mass).toBe(100)
    expect(s.canStage()).toBe(false)
    expect(s.stage()).toEqual([]) // nothing left to stage
  })

  it('flows engine sea-level thrust/Isp through to the structure by pressure ratio', () => {
    const atmoDefs = new Map<string, PartDefinition>([
      ['booster', { id: 'booster', dryMass: 1000, inertia: MAT3_ZERO, modules: [
        { kind: 'engine', maxThrust: 2000, isp: 320, thrustSeaLevel: 1600, ispSeaLevel: 280 },
        { kind: 'tank', capacity: 5000 },
      ] }],
    ])
    const s = new VehicleStructure([part({ instanceId: 'b', defId: 'booster' })], atmoDefs)

    // Vacuum (ratio 0) → vacuum values; sea level (ratio 1) → sea-level values.
    expect(s.totalMaxThrust(0)).toBe(2000)
    expect(s.isp(0)).toBe(320)
    expect(s.totalMaxThrust(1)).toBe(1600)
    expect(s.isp(1)).toBe(280)
    expect(s.totalMaxThrust(0.5)).toBe(1800)
    // Default arg is vacuum.
    expect(s.totalMaxThrust()).toBe(2000)
  })

  it('drains proportionally across multiple tanks', () => {
    const s = new VehicleStructure(
      [
        part({ instanceId: 'a', defId: 'tank', fuel: 1000 }),
        part({ instanceId: 'b', defId: 'tank', localPosition: [0, 0, 2], fuel: 3000 }),
      ],
      defs,
    )
    expect(s.totalFuel()).toBe(4000)
    s.drain(2000) // half of total → each tank loses half
    expect(s.totalFuel()).toBeCloseTo(2000, 6)
  })
})
