import { WebGPURenderer } from 'three/webgpu'

/** Backend options we may override per canvas (subset of WebGPURendererParameters). */
interface WebGPUBackendOverrides {
  /** Reversed-Z depth — far better precision across wide near/far ranges. */
  reversedDepthBuffer?: boolean
  logarithmicDepthBuffer?: boolean
  antialias?: boolean
  alpha?: boolean
}

/**
 * Build an R3F `<Canvas gl={...}>` factory that creates a `WebGPURenderer`.
 *
 * `forceWebGL: false` keeps the WebGPU backend where the browser supports it and
 * lets three fall back to WebGL2 automatically otherwise. The factory is async
 * because acquiring the WebGPU device (`renderer.init()`) is async — R3F awaits the
 * returned promise before mounting the scene.
 *
 * `overrides` are merged last so a canvas can opt into backend features it needs
 * (e.g. `reversedDepthBuffer` for the vehicle view's near-vehicle / far-planet
 * depth precision).
 */
export function makeWebGPURenderer(overrides: WebGPUBackendOverrides = {}) {
  // `props` is R3F's DefaultGLProps (the canvas plus resolved GL options). It's typed
  // loosely here because R3F's internal OffscreenCanvas type doesn't line up with the
  // DOM lib type at this interop seam; the canvas is always a real HTMLCanvasElement.
  return async (props: {
    canvas: unknown
    antialias?: boolean
    alpha?: boolean
  }): Promise<WebGPURenderer> => {
    const renderer = new WebGPURenderer({
      canvas: props.canvas as HTMLCanvasElement,
      antialias: props.antialias ?? true,
      alpha: props.alpha ?? true,
      forceWebGL: false,
      ...overrides,
    })
    await renderer.init()
    return renderer
  }
}
