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
