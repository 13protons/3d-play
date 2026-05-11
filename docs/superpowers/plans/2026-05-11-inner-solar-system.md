# Inner Solar System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable inner-solar-system scenario with Mercury, Venus, Earth, Mars, and their moons to stress-test n-body dynamics.

**Architecture:** Keep the existing data-driven body/scenario loading path. Add body JSON definitions, one scenario JSON file, a small scenario validation helper/test, and a second hardcoded launch button in the existing main menu.

**Tech Stack:** TypeScript, React, Vite public JSON assets, Vitest

---

## File Structure

| File | Purpose |
|------|---------|
| `src/data/scenarioValidation.ts` | Validates scenario body references and body file availability for tests/tooling. |
| `src/data/__tests__/scenarioValidation.test.ts` | Tests that inner solar system references all required body definitions. |
| `public/data/bodies/mercury.json` | Mercury intrinsic body definition. |
| `public/data/bodies/venus.json` | Venus intrinsic body definition. |
| `public/data/bodies/mars.json` | Mars intrinsic body definition. |
| `public/data/bodies/phobos.json` | Phobos intrinsic body definition. |
| `public/data/bodies/deimos.json` | Deimos intrinsic body definition. |
| `public/data/scenarios/inner-solar-system.json` | Selectable scenario with Sun, four inner planets, Moon, Phobos, Deimos, and Earth orbiter. |
| `src/ui/MainMenu.tsx` | Adds second launch button. |

## Tasks

- [ ] Write failing validation test for the new scenario asset.
- [ ] Implement minimal validation helper.
- [ ] Add missing body definition JSON files.
- [ ] Add `inner-solar-system.json` using circular coplanar heliocentric approximations.
- [ ] Update `MainMenu.tsx` with separate launch buttons.
- [ ] Run targeted test, typecheck, full tests, and build.
