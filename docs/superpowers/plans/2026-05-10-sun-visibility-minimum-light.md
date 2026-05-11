# Sun Visibility and Minimum Light Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve vehicle-view realism by making Sun visibility respond to body occlusion and giving planets a declarative minimum-light floor for dark-side readability.

**Architecture:** Keep this render-only and preserve the existing trajectory pipeline. Body JSON gains optional render metadata, the bridge forwards it into `BodyMeta`, shared pure helpers compute Sun line-of-sight occlusion, and both orbital/vehicle body materials use one consistent minimum-light material policy.

**Tech Stack:** TypeScript, React Three Fiber, Three.js, Zustand, Vitest

---

## File Structure

| File | Purpose |
|------|---------|
| `src/render/lighting.ts` | Pure vector math for Sun line-of-sight occlusion and distant Sun projection. |
| `src/render/__tests__/lighting.test.ts` | TDD coverage for occlusion behavior. |
| `src/state/trajectories.ts` | Extend `BodyMeta` with declarative `minimumLight`. |
| `src/state/bridge.ts` | Load `render.minimumLight` from body definitions. |
| `src/render/Body.tsx` | Apply minimum-light material policy in orbital view. |
| `src/render/VehicleScene.tsx` | Apply minimum-light material policy and Sun occlusion in vehicle view. |
| `public/data/bodies/*.json` | Add render metadata for Earth/Moon/Sun. |

## Task 1: Sun Occlusion Helper

- [ ] Write failing tests for line-segment/sphere Sun occlusion.
- [ ] Run `npx vitest run src/render/__tests__/lighting.test.ts` and confirm the missing module failure.
- [ ] Implement `isSunOccluded` and `projectDistantSphere` in `src/render/lighting.ts`.
- [ ] Re-run the helper test and confirm it passes.

## Task 2: Declarative Minimum Light

- [ ] Add `minimumLight?: number` to `BodyMeta`.
- [ ] Load `render.minimumLight` in `startSim()` with default `0`.
- [ ] Add minimum-light values to body JSON: Earth brighter than Moon, Sun remains self-lit.

## Task 3: Render Wiring

- [ ] Apply non-star minimum light as a low material emissive floor matching body color.
- [ ] Keep `emissive: true` reserved for self-luminous bodies like the Sun.
- [ ] In vehicle view, compute vehicle/Sun/body positions each frame, render the Sun as an angular-size proxy inside the camera range, and dim the Sun material/light when Earth or Moon blocks line-of-sight.
- [ ] Preserve the current floating-origin positioning and body hierarchy filtering.

## Task 4: Verification

- [ ] Run `npm run typecheck`.
- [ ] Run `npx vitest run src/render/__tests__/lighting.test.ts`.
- [ ] Run `npm run build` if typecheck and targeted tests pass.
