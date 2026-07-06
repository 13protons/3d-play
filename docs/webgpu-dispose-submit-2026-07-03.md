# WebGPU: disposed buffers in cached submits (2026-07-03)

Status: **mostly fixed** — the editor-apply form is gone (preserveScene) and
the page-load form is gone (StrictMode removed, see update below); a rare
transient remains, parked here with the diagnosis so it isn't re-derived.

## Update 2026-07-06 — StrictMode made it deterministic on Chrome 149

On Chrome 149 every page load wedged (60 rejected submits/sec, starfield or
body pass dead), across code versions — verified by stashing to a known-good
commit, fresh dev server, fresh browser process. Root cause: **React
StrictMode's dev double-mount** — mount → unmount (mass geometry/material
disposal, same class of event as the old editor teardown) → remount, on every
load. On earlier Chrome builds the disposal race hit intermittently; Chrome
149's timing makes it hit every time. Fixed by removing StrictMode from
`src/main.tsx` (comment there explains). Re-enable only if the underlying
dispose-while-cached-submit bug is fixed (three upgrade or the in-place-update
direction below).

## What happened

The scene editor's restart-on-apply (`stopSim()` + `startSimWithScenario()`)
intermittently left the orbital view blank — stars and sun only, every
body/orbit-line invisible — for tens of seconds or until another apply. Sim
state, camera, and the React tree were all verified correct in the broken
state; the actual failure was at the GPU layer: **every frame's scene-pass
submit was rejected** with

```
[Buffer (unlabeled)] used in submit while destroyed.
 - While calling [Queue].Submit([[CommandBuffer from CommandEncoder "renderContext_2"]])
```

(~60 rejections/sec, confirmed via `device.addEventListener('uncapturederror')`;
Chrome caps the console warning at 500 so it looks like it stops.)

Mechanism: `stopSim()` reset the trajectories store (`bodies: {}`), unmounting
every `Body`/orbit-line/atmosphere component. R3F + our cleanup effects then
disposed ~43 GPU buffers per apply while the same live canvas kept rendering.
three's WebGPU backend intermittently keeps a destroyed buffer referenced in a
cached submit, and WebGPU rejects the entire command buffer — so one stale
line buffer blanks the whole pass, every frame, until some later rebuild
happens to evict it.

## Fixes applied

- `stopSim({ preserveScene: true })` (used by the editor's apply): keeps
  `curves`/`bodies`/`vehicles` populated across the restart so nothing
  unmounts; the incoming run overwrites them.
- `setBodies`/`setVehicles` now preserve object identity for content-unchanged
  entries, so `BodyMaterial`'s `useMemo([body])` doesn't rebuild + dispose
  every material per apply.

Result: sustained-blank is gone; 25-apply stress runs render throughout.

## Residual (parked)

Roughly 1 in ~25 applies still produces a burst of ~20 rejected submits
(~0.3 s). Labelled-buffer tracing (patch `GPUDevice.createBuffer` to stamp a
stack-derived label) shows the destroyed buffers are **fat-line instance
buffers** (`LineGeometry`, created via `Attributes.update`) — i.e. the
`WebGPULine` swap-and-dispose on points change. Deferring the dispose by one
rAF or even 100 ms does **not** help (tested), so the stale reference lives in
a longer-lived backend cache, not the in-flight frame — this looks like an
upstream three.js WebGPU renderer bug. Visible impact is minimal (the post
chain shows the previous frame). If it starts to matter:

- check newer three releases for renderObject/attribute cache invalidation
  fixes around `dispose()`;
- or update fat-line positions in place when the point count is unchanged
  (no realloc → nothing to destroy).
