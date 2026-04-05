# Celestial Body Definitions

One JSON file per celestial body. Contains intrinsic properties organized by consumer concern.

## Format

See [notes/04-entity-definitions.md](../../notes/04-entity-definitions.md) for the full schema.

```
{
  "id": "earth",
  "name": "Earth",
  "parentId": "sun",
  "physics": { mass, radius, soiRadius, axialTilt, angularVelocity, atmosphereModel },
  "render": { color, emissive, texture, rings },
  "terrain": { generator, seed, ... }
}
```

Physics sections are loaded by the orbital worker. Render sections are loaded by the renderer. Neither loads the other's data.
