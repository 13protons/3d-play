# Coordinate System

Status: **Decided**

## Segmented Coordinates (Sector + Local Offset)

Every position is encoded as two parts:

```typescript
interface SectorPosition {
  sector: [ix: number, iy: number, iz: number]  // integers
  local:  [x: number, y: number, z: number]     // 0 ≤ val < SECTOR_SIZE
}

const SECTOR_SIZE = 1_000_000  // 1000 km in meters
```

- **Sector**: integer grid index. Which 1000km cube. Heliocentric origin — Sun at `[0,0,0]`. Ranges from negative to positive. Integers are exact in float64 up to 2^53, and Sun-to-Neptune is ~4.5M sectors per axis, so no issues.
- **Local offset**: float64, always between 0 and 999,999.999m. With values this small, float64 gives sub-micrometer precision.

### Why not one big float64?

Earth's orbital position + a craft offset would consume all ~15 significant digits, leaving nothing for vehicle-scale precision. Sectors keep the solar-system-scale part in exact integers, so the float64 budget is spent entirely on local precision.

### Why not all-integer (fixed-point)?

JS has no native integer type. `number` is float64 under the hood. BigInt is 10-100x slower. Physics math (division, sqrt, varying magnitudes) fights fixed-point. No perf gain in JS — float64 IS the native numeric type.

### Sector Size

`SECTOR_SIZE` is a named constant, not a magic number. 1,000 km is the default but the exact value isn't load-bearing — any size from 100 km to 10,000 km gives sub-micrometer precision for surface collision, fits the solar system in safe integer range, and has negligible normalization cost. It can be changed in one line with zero structural impact since all sector math goes through `relativePosition()` and `normalize()`.

### Sectors Are Not Containers

Nothing "lives in" a sector. No neighbor lookups. No boundary edge cases. Objects have point positions (sector+local) and separate scalar properties (radius, mesh bounds). This is fundamentally different from Minecraft chunks. A sector position is just a way of writing down a coordinate — like hours:minutes vs. raw minutes.

### Normalization

When `local` goes below 0 or above `SECTOR_SIZE`, adjust the integer sector and wrap. One if-statement per axis, hidden in a single `normalize()` function. Nothing else in the codebase sees it.

## Cross-Sector Relative Positions

All physics and collision math operates on relative vectors:

```typescript
function relativePosition(from: SectorPosition, to: SectorPosition): [number, number, number] {
  return [
    (to.sector[0] - from.sector[0]) * SECTOR_SIZE + (to.local[0] - from.local[0]),
    (to.sector[1] - from.sector[1]) * SECTOR_SIZE + (to.local[1] - from.local[1]),
    (to.sector[2] - from.sector[2]) * SECTOR_SIZE + (to.local[2] - from.local[2]),
  ]
}
```

This is precision-safe because:
- `sectorDelta * SECTOR_SIZE` is an integer × a power of 10 — exact in float64
- `localDelta` is a subtraction of two numbers both under 1e6 — precise
- The combined result is at body-radius scale (~1e6–1e9), well within float64's 15-digit budget

### Precision Budget

| Body         | Radius      | Digits used | Spare digits | Min resolution |
|--------------|-------------|-------------|--------------|----------------|
| Moon         | 1,737 km    | 7           | ~9           | nanometers     |
| Earth        | 6,371 km    | 7           | ~9           | nanometers     |
| Jupiter      | 69,911 km   | 8           | ~8           | nanometers     |
| Sun          | 696,000 km  | 9           | ~7           | sub-micrometer |
| Earth orbit  | 1.496e8 km  | 12          | ~4           | centimeters    |

Sectors protect from absolute position magnitude. They can't (and don't need to) protect from relative distance magnitude — body-radius-scale distances already have plenty of float64 precision.

## Floating-Origin Camera-Relative Rendering

Three.js sends float32 to the GPU (~7 significant digits). A craft at Earth's orbit in absolute coordinates would have meter-scale jitter.

Solution: at render time, compute camera-relative positions using the same `relativePosition` function. The camera's `SectorPosition` is the floating origin. Nearby objects get small coordinates (full float32 precision). Distant objects get large coordinates but are tiny on screen (jitter invisible).
