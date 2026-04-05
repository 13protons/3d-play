# Scenarios

Initial state files that define which bodies to load and their positions/velocities at epoch. Separate from body definitions so the same bodies can be used in different configurations.

## Format

See [notes/04-entity-definitions.md](../../notes/04-entity-definitions.md) for the full schema.

```
{
  "id": "sun-earth-moon",
  "name": "Sun-Earth-Moon System",
  "epoch": 0,
  "bodies": {
    "sun": { position, velocity, rotationPhase },
    "earth": { position, velocity, rotationPhase },
    "moon": { position, velocity, rotationPhase }
  }
}
```

Scenarios reference body IDs from `data/bodies/`. A minimal scenario (sun-earth-moon) is useful for development; a full solar system scenario loads everything.
