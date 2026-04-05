# Solar — Architecture Overview

## What Is This

A KSP-like space sim in the browser using React, TypeScript, Three.js, and React Three Fiber. Targeting true n-body physics with Lagrange points and orbit destabilization — not patched conics.

## First Milestone

Orbiting bodies only: Sun + a few planets/moons under gravity, camera-relative rendering, time warp. No vessels, no editor, no terrain. Proves the coordinate system, physics worker, and floating origin all work together.

## Architecture Documents

| Doc | Status | Summary |
|-----|--------|---------|
| [01-project-structure](01-project-structure.md) | Decided | Directory layout, module boundaries, data flow |
| [02-coordinate-system](02-coordinate-system.md) | Decided | Sector + local offset, floating-origin rendering |
| [03-entities-and-parts](03-entities-and-parts.md) | Decided | Part tree, data-driven defs, hybrid decoupling |
| [04-entity-definitions](04-entity-definitions.md) | Decided | Body/part JSON format, scenarios, three-layer world data |
| [05-physics-workers](05-physics-workers.md) | Decided | Three-worker architecture, trajectory curves, build sequence |
| [06-environment-patches](06-environment-patches.md) | Decided | Local atmospheric/terrain/gravity sampling for vehicle workers |
| [07-input-and-commands](07-input-and-commands.md) | Decided | Command buffering, time warp, multiplayer considerations |
| [08-state-management](08-state-management.md) | Decided | Zustand stores, bridge pattern, inter-worker relay |
| [09-game-modes](09-game-modes.md) | Decided | Sim/view state axes, canvas management, input context stack |
