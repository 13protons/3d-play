/**
 * Terrain generators — deterministic, pure math.
 *
 * Shared by the orbital worker (for physics collision/environment patches)
 * and the renderer (for visual LOD mesh generation).
 *
 * Each generator takes a body ID + surface coordinates and returns height data.
 * Generators are registered by name and referenced from body definitions.
 */

// Placeholder — terrain generation will be implemented when surface physics are needed.
// The key contract: same inputs always produce same outputs (deterministic, no side effects).
