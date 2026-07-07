import { DoubleSide, MeshStandardMaterial } from 'three'

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
  // DoubleSide: the bell is an open surface — cull nothing so it reads solid from
  // outside and you can see up into the nozzle mouth from below.
  return new MeshStandardMaterial({ color, metalness: 0.9, roughness: 0.35, side: DoubleSide })
}
