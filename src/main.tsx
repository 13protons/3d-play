import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'

// No StrictMode: its dev-mode double-mount tears down and re-creates every GPU
// resource on load, and three's WebGPU backend intermittently keeps destroyed
// buffers in cached submits (see docs/webgpu-dispose-submit-2026-07-03.md).
// On Chrome 149+ that wedge became deterministic — every page load rendered a
// dead scene pass. Re-enable if the upstream disposal bug is fixed.
createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
