# JPL Full Solar System Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a realistic full-solar-system startup snapshot and a one-year n-body drift validation test against static JPL/Horizons reference data.

**Architecture:** Keep runtime offline and data-driven. Store generated JPL state vectors in TypeScript fixtures, convert the initial fixture into an existing scenario JSON format, and compare one-year integrated positions against the second fixture in Vitest.

**Tech Stack:** TypeScript, Vite public JSON assets, Vitest, Dormand-Prince n-body integrator

---

## File Structure

| File | Purpose |
|------|---------|
| `src/sim/ephemeris.ts` | Converts absolute vectors to scenario sector/local positions and packs n-body states for tests. |
| `src/sim/__fixtures__/jpl-full-solar-system.ts` | Static initial and +1 year JPL/Horizons vectors in SI units. |
| `src/sim/__tests__/ephemeris.test.ts` | Tests vector-to-scenario conversion and one-year drift. |
| `public/data/bodies/jupiter.json` | Jupiter body definition. |
| `public/data/bodies/saturn.json` | Saturn body definition. |
| `public/data/bodies/uranus.json` | Uranus body definition. |
| `public/data/bodies/neptune.json` | Neptune body definition. |
| `public/data/scenarios/full-solar-system.json` | Selectable full-system scenario from the initial JPL snapshot. |
| `src/data/__tests__/scenarioValidation.test.ts` | Extends asset validation to the full-system scenario. |
| `src/ui/MainMenu.tsx` | Adds the full-solar-system launch option. |

## Tasks

- [ ] Fetch JPL/Horizons vectors for Sun, major planets, Moon, Phobos, and Deimos at fixed epoch and +1 year.
- [ ] Write failing tests for scenario asset validation and ephemeris conversion.
- [ ] Implement minimal `ephemeris.ts` conversion helpers.
- [ ] Add outer planet body definitions.
- [ ] Add `full-solar-system.json` generated from the initial JPL snapshot.
- [ ] Add one-year n-body drift validation against the +1 year fixture with useful per-body tolerances.
- [ ] Add third main menu launch option.
- [ ] Run targeted tests, typecheck, full tests, and build.
