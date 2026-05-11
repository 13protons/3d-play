# Body Sprite LOD Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep distant planets visible in orbital view by rendering them as fixed-size camera-facing circle sprites, while suppressing moon sprites when they visually collapse into their parent planet.

**Architecture:** Preserve the current R3F/floating-origin render pipeline. Add pure LOD helper functions with tests, a small reusable circle sprite component, and update `Body.tsx` to choose mesh versus sprite based on projected screen size and parent-child screen separation.

**Tech Stack:** TypeScript, React Three Fiber, Three.js, Vitest

---

## File Structure

| File | Purpose |
|------|---------|
| `src/render/lod.ts` | Pure projected-size and sprite-suppression helper functions. |
| `src/render/__tests__/lod.test.ts` | Tests for mesh/sprite and moon suppression thresholds. |
| `src/render/OrbitalMarker.tsx` | Shared camera-facing filled and outlined marker sprite for bodies and vehicles. |
| `src/render/Body.tsx` | Toggle body mesh/sprite visibility each frame in orbital view. |

## Tasks

- [ ] Write failing tests for projected radius, sprite mode, and child sprite suppression.
- [ ] Implement `projectedRadiusPx`, `spriteWorldSize`, `shouldUseBodySprite`, and `shouldSuppressChildSprite`.
- [ ] Add `OrbitalMarker` with fixed-pixel apparent size via world-scale updates from callers.
- [ ] Update orbital `Body` rendering so small projected bodies use sprites instead of becoming invisible.
- [ ] Suppress child sprites when their projected screen separation from parent is below threshold; do not enlarge parent sprites.
- [ ] Update the existing vehicle marker to use the same marker component with a triangle shape.
- [ ] Verify with targeted tests, typecheck, full tests, and build.
