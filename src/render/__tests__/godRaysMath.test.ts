import { describe, expect, it } from 'vitest'
import { PerspectiveCamera } from 'three'
import { sunScreenState } from '../godRaysMath'

function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, 16 / 9, 1000, 1e15)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)
  camera.updateMatrixWorld(true)
  return camera
}

describe('sunScreenState', () => {
  it('centres a sun straight ahead at full intensity', () => {
    const { uv, intensity } = sunScreenState([0, 0, -1e11], makeCamera())
    expect(uv[0]).toBeCloseTo(0.5, 5)
    expect(uv[1]).toBeCloseTo(0.5, 5)
    expect(intensity).toBe(1)
  })

  it('zeroes intensity for a sun behind the camera', () => {
    const { intensity } = sunScreenState([0, 0, 1e11], makeCamera())
    expect(intensity).toBe(0)
  })

  it('keeps full intensity just off-screen and fades to zero further out', () => {
    const camera = makeCamera()
    // ~half-fov ≈ 25° vertically; place the sun ~just past the top edge (ndc y ≈ 1.1)
    const justOff = sunScreenState([0, Math.tan((27 * Math.PI) / 180) * 1e11, -1e11], camera)
    expect(justOff.intensity).toBe(1)
    expect(justOff.uv[1]).toBeGreaterThan(1)

    // Far off-screen (ndc ≈ 2.3): rays fully faded
    const farOff = sunScreenState([0, Math.tan((47 * Math.PI) / 180) * 1e11, -1e11], camera)
    expect(farOff.intensity).toBe(0)
  })

  it('fades partially between the margins', () => {
    const camera = makeCamera()
    // ndc y ≈ 1.5: inside the fade band
    const y = Math.tan((25 * Math.PI) / 180) * 1.5 * 1e11
    const { intensity } = sunScreenState([0, y, -1e11], camera)
    expect(intensity).toBeGreaterThan(0)
    expect(intensity).toBeLessThan(1)
  })
})
