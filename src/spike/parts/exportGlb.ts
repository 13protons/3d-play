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
