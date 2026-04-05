# Part Definitions

One JSON file per part type. Defines physics properties, rendering info, and attachment points.

## Format

See [notes/04-entity-definitions.md](../../notes/04-entity-definitions.md) for the full schema.

```
{
  "id": "mk1-command-pod",
  "name": "Mk1 Command Pod",
  "physics": { dryMass, fuelCapacity, dragCoefficient, ... },
  "render": { model, texture, ... },
  "attach": { points: [{ id, position, direction, ... }] }
}
```

The vehicle worker loads physics + attach sections. The renderer loads render + attach sections.
