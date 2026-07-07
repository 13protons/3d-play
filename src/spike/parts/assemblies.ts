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
