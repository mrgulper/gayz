import * as THREE from 'three'

// Single on/off switch for the "flat, single-color, cheap material"
// rendering mode requested 2026-07-21 while the real fps bottleneck is
// still unresolved. Deliberately does NOT touch any asset loading/model
// code, geometry, or animation - only which MATERIAL gets applied to
// already-built meshes. Flip back to false (or delete this file and its
// call sites) to restore the full-detail look built during the 3D asset
// overhaul - nothing about that work was removed, just temporarily not
// used for rendering.
export const LOW_QUALITY_MODE = false

// Drop-in replacement for `new THREE.MeshStandardMaterial(opts)` used
// across World.js's ~160 material call sites. Under LOW_QUALITY_MODE,
// builds a MeshLambertMaterial instead (cheaper Lambertian lighting model
// vs. Standard's roughness/metalness PBR calculation, evaluated per pixel
// against every one of this scene's ~65 lights) keeping only the
// properties Lambert actually supports (color/map/emissive/
// emissiveIntensity) - roughness/metalness are silently dropped rather
// than passed through, since Lambert doesn't have those properties and
// passing them anyway just produces console warnings for no benefit.
// When the flag is false, behaves exactly like `new
// THREE.MeshStandardMaterial(opts)` always did.
// Cached wrapper around flatMaterial(), for callers that build large
// numbers of static, NEVER-MUTATED-AFTER-CREATION objects with a lot of
// repeated option combos - see docs/PERFORMANCE.md Option B1. World.js's
// buildWorld() is the only current caller: measured at 8,869 material
// instances for only 332 truly distinct combinations (27x duplication),
// and that count was taken with zero zombies/companions/other dynamic
// objects alive, meaning the duplication is coming entirely from static
// world geometry, not gameplay objects - so this is deliberately NOT
// wired into flatMaterial() itself, which 16 other files (zombies,
// companions, weapons, pickups, chests...) also call for objects that
// DO get individually recolored/faded at runtime (hit flashes, tracers,
// muzzle flash, jacket tints). Sharing those would silently recolor
// every object sharing the cached instance the moment one of them got
// hit - see this project's own CLAUDE.md "Shared-material mutation"
// note. Only use this for material construction whose result is never
// individually mutated after creation; if in doubt, use flatMaterial().
const _sharedMatCache = new Map()
export function cachedFlatMaterial(opts) {
  // Textures (map/bumpMap/emissiveMap) can't be meaningfully
  // JSON.stringify'd (circular/huge internal structure) and a fresh
  // TextureLoader().load(...) or `new THREE.CanvasTexture(...)` call
  // never produces the same instance twice anyway - keying on each
  // texture's own stable .uuid instead correctly merges only calls that
  // were handed the literal same texture object, never two different
  // ones that just happen to look similar.
  const key = JSON.stringify({
    ...opts,
    map: opts.map?.uuid,
    bumpMap: opts.bumpMap?.uuid,
    emissiveMap: opts.emissiveMap?.uuid,
  })
  let mat = _sharedMatCache.get(key)
  if (!mat) {
    mat = flatMaterial(opts)
    _sharedMatCache.set(key, mat)
  }
  return mat
}

export function flatMaterial(opts) {
  if (!LOW_QUALITY_MODE) return new THREE.MeshStandardMaterial(opts)
  const simple = {}
  // Some call sites only set map/emissive with no base `color` at all
  // (relying on MeshStandardMaterial's own default white) - only include
  // the key when it's actually present, rather than passing `color:
  // undefined` through (three.js logs a console warning for any
  // explicitly-undefined material property).
  if (opts.color !== undefined) simple.color = opts.color
  if (opts.map) simple.map = opts.map
  if (opts.emissive !== undefined) simple.emissive = opts.emissive
  if (opts.emissiveMap) simple.emissiveMap = opts.emissiveMap
  if (opts.emissiveIntensity !== undefined) simple.emissiveIntensity = opts.emissiveIntensity
  return new THREE.MeshLambertMaterial(simple)
}

// Drop-in replacement for the very common `child.material =
// child.material.clone()` pattern used everywhere a GLB gets cloned per
// instance (zombies, companion, rival, chests, pickups, viewmodels,
// dozens of World.js props). A plain .clone() copies the ORIGINAL
// textured/PBR material as-is - under LOW_QUALITY_MODE this instead
// builds a flat MeshLambertMaterial from whatever that original material
// had (color/map/emissive/emissiveMap/emissiveIntensity), same idea as
// flatMaterial above but starting from an existing material object
// instead of a fresh options literal. When the flag is false, behaves
// exactly like `original.clone()` always did.
export function flattenedClone(original) {
  if (!LOW_QUALITY_MODE) return original.clone()
  const simple = {}
  // Dropped previously - callers that key off material.name post-clone
  // (e.g. Companion.js's _buildBodyFromGLB matching the "Main" slot to
  // apply a per-role jacket tint) silently never matched anything under
  // LOW_QUALITY_MODE, since the fresh MeshLambertMaterial below defaulted
  // to name: '' instead of carrying the original slot name forward.
  if (original.name) simple.name = original.name
  if (original.color) simple.color = original.color.clone()
  if (original.map) simple.map = original.map
  if (original.emissive) simple.emissive = original.emissive.clone()
  if (original.emissiveMap) simple.emissiveMap = original.emissiveMap
  if (original.emissiveIntensity !== undefined) simple.emissiveIntensity = original.emissiveIntensity
  return new THREE.MeshLambertMaterial(simple)
}
