import * as THREE from 'three'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh'

// BVH-accelerated raycasting for the static world (three-mesh-bvh). Every
// gameplay raycast in this codebase - weapon fire (every pellet, plus aim
// assist's extra rays), zombie/rival line-of-sight, the indoor check, the
// grapple, ground/ceiling sampling - intersects against `solidMeshes`, and
// since docs/PERFORMANCE.md's B3 merged most buildings into one big mesh per
// material group, a ray that clips a building's bounding sphere used to test
// every triangle in that whole merged building one by one. Measured
// 2026-09-28 at the spawn point: ~1.9ms per weapon-fire ray (a shotgun blast
// is 8+ of those in one frame - a visible hitch), ~1ms for one straight-up
// indoor-check ray even when narrowed to the nearby grid cells, because the
// cost was a handful of huge merged meshes, not how many meshes were
// checked. A BVH turns each of those into a tree walk of a few dozen nodes.
//
// Only ever built for the static world meshes passed to ensureBoundsTrees()
// (solidMeshes) - never globally/lazily for every mesh, since a BVH is a
// snapshot of the geometry's vertex positions and anything whose vertices
// change after the fact (skinned zombies, decals, trails) would silently
// raycast against stale data. Geometry transforms (moving a door, the
// pendulum) are fine: the BVH is in the geometry's own local space, same as
// the triangles it indexes. Anything without a boundsTree falls straight
// through to three.js's normal Mesh raycast, so a mesh added later that
// somehow never gets one is slower, never wrong.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
THREE.Mesh.prototype.raycast = acceleratedRaycast

// Below this, a plain triangle loop is already about as cheap as a tree walk
// (most small props are a 12-triangle box) - not worth the memory.
const MIN_TRIANGLES_FOR_BVH = 64

function triangleCount(geometry) {
  if (geometry.index) return geometry.index.count / 3
  const pos = geometry.attributes.position
  return pos ? pos.count / 3 : 0
}

// Idempotent and cheap to call again - skips any geometry that already has
// a tree, so callers can re-run it over the whole list whenever the list
// grows (deferred tile content, see CachedMeshGrid's rebuild) rather than
// tracking which entries are new.
export function ensureBoundsTrees(meshes) {
  for (const root of meshes) {
    root.traverse((obj) => {
      if (!obj.isMesh || obj.isSkinnedMesh) return
      const geometry = obj.geometry
      if (!geometry || geometry.boundsTree || geometry.__noBoundsTree) return
      if (!geometry.attributes.position || triangleCount(geometry) < MIN_TRIANGLES_FOR_BVH) {
        geometry.__noBoundsTree = true
        return
      }
      geometry.computeBoundsTree()
    })
  }
}
