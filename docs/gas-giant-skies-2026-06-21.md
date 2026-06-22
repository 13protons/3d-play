# Gas-giant sky palettes — future enhancement (2026-06-21)

## Context

The vehicle-view sky is a cheap analytic dome (`src/render/sky/VehicleSky.tsx`) tinted
per planet from a `sky` palette in each body's `atmosphere.json`
(`AtmosphereSkyColors` in `src/state/trajectories.ts`). We shipped palettes for the three
**landable** atmospheric bodies:

| Body | Day (zenith → horizon) | Sun halo | Low-sun glow → deep |
|---|---|---|---|
| Earth | blue `#2a62c4` → `#a9c6ec` | `#fff0d8` | orange `#ff7a26` → red `#ff3a0e` |
| Mars | butterscotch `#c79a6a` → `#e3c39c` | bluish `#dbe6ff` | **blue** `#6f9fd8` → `#3f6aa8` |
| Venus | ochre `#9c6b35` → `#7a4a22` | `#c89a55` | ochre `#b07a3a` → `#6e3f1c` |

The gas giants (Jupiter, Saturn, Uranus, Neptune) were intentionally **deferred**: they
have no solid surface to stand on, so the dome would essentially never render with the
current vehicle/landing model. This doc records the research so they're a quick add if/when
"flying in the upper atmosphere of a gas giant" becomes a supported scenario.

## What's blocking a straight port

The dome model (`sunHorizon.ts`) needs a **planet radius** and an **atmosphere shell
thickness** above that radius — i.e. a defined "surface." Gas giants have no surface; the
natural reference is the **1-bar level** (the conventional "radius" already in the
manifests) with the visible cloud deck as the shell. So enabling them is mostly:

1. Decide the reference radius = 1-bar level (already the manifest `radius`).
2. Author `atmosphere.json` for each (shellHeight, scaleHeight, Rayleigh/Mie, `sky`).
3. Wire `render.atmosphere` in each manifest (as done for Mars/Venus).
4. Make the body "enterable" so the camera can sit inside the atmosphere (the
   `withinAtmosphere` gate + camera clamp already handle the rest).

## Proposed `sky` palettes (for an observer near the cloud tops)

Sunlight is dim and falls off with distance (Jupiter ≈ 1/27 Earth, Neptune ≈ 1/900), so
all of these read darker than Earth's. Colors are best-guess from atmospheric composition,
not photographs (no probe has imaged these skies):

- **Jupiter** — H₂ Rayleigh gives a blue overhead fading into brown/tan ammonia-cloud haze
  bands. `zenith #6f86c8`, `horizon #b89a6e`, `sunHalo #fff3da`, low-sun `#caa45e` → `#7a5a2e`.
- **Saturn** — like Jupiter but paler and more golden. `zenith #8aa0cf`, `horizon #d8c294`,
  `sunHalo #fff3da`, low-sun `#d2ad62` → `#8a6a34`.
- **Uranus** — methane absorbs red, leaving a cyan/aquamarine sky. `zenith #4fb7c0`,
  `horizon #b6e6e6`, `sunHalo `#eafcff`, low-sun `#6fcfc4` → `#2f7e84`.
- **Neptune** — deeper methane blue/azure. `zenith #2a5fb0`, `horizon #8fb8e8`,
  `sunHalo #eaf2ff`, low-sun `#4f86c8` → `#1f3f80`.

## Pointers

- Schema: `AtmosphereSkyColors` in `src/state/trajectories.ts`
- Dome + stars + sampler: `src/render/sky/VehicleSky.tsx`
- Geometry/estimator: `src/render/sky/sunHorizon.ts`
- Reference data files: `public/data/bodies/{earth,mars,venus}/atmosphere.json`
