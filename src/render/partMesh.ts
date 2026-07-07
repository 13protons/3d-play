export const PART_MESH_BASE = '/models/parts/'

export function partMeshUrl(meshId: string): string {
  return `${PART_MESH_BASE}${meshId}.glb`
}

export function usesBakedMesh(def: { meshId?: string }): boolean {
  return typeof def.meshId === 'string' && def.meshId.length > 0
}
