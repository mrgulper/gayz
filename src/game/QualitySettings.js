// Single on/off switch for the "flat, single-color, cheap material"
// rendering mode requested 2026-07-21 while the real fps bottleneck is
// still unresolved. Deliberately does NOT touch any asset loading/model
// code, geometry, or animation - only which MATERIAL gets applied to
// already-built meshes. Flip back to false (or delete this file and its
// two call sites) to restore the full-detail look built during the 3D
// asset overhaul - nothing about that work was removed, just temporarily
// not used for rendering.
export const LOW_QUALITY_MODE = true
