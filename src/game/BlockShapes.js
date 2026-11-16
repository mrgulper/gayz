import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// The 3D shapes of non-cube blocks (stairs, fences, slabs, doors, ladders,
// game blocks, train track). Moved out of BuildMode.js (2026-11-16).

// One block's size in world units (see BuildMode.js for the history).
export const BLOCK_SIZE = 0.35

// Non-cube block shapes (see BLOCK_TYPES' `shape` field) - every other
// block reuses one shared full-cube BoxGeometry across its whole
// InstancedMesh; these three build their own once, referenced by `shape`
// in the per-type mesh loop below. Collision/placement (_blockedAt,
// getBlockAt) stay shape-blind on purpose - a placed stair/fence/ladder
// still occupies its whole grid cell for movement the exact same way a
// solid cube would, matching every existing thin-looking block (glass,
// leaves) which already collides as a full cube despite not looking
// solid. Only the render geometry is different; nothing about placement,
// removal, save/load, or collision needed to change.
function _buildStairGeometry() {
  const half = BLOCK_SIZE / 2
  const bottom = new THREE.BoxGeometry(BLOCK_SIZE, half, BLOCK_SIZE)
  bottom.translate(0, -half / 2, 0)
  const top = new THREE.BoxGeometry(BLOCK_SIZE, half, half)
  top.translate(0, half / 2, half / 2)
  return mergeGeometries([bottom, top])
}

function _buildFenceGeometry() {
  const postW = BLOCK_SIZE * 0.16
  const railH = BLOCK_SIZE * 0.12
  const post = new THREE.BoxGeometry(postW, BLOCK_SIZE, postW)
  const railX1 = new THREE.BoxGeometry(BLOCK_SIZE, railH, postW * 0.8)
  railX1.translate(0, BLOCK_SIZE * 0.18, 0)
  const railX2 = railX1.clone()
  railX2.translate(0, -BLOCK_SIZE * 0.36, 0)
  const railZ1 = new THREE.BoxGeometry(postW * 0.8, railH, BLOCK_SIZE)
  railZ1.translate(0, BLOCK_SIZE * 0.18, 0)
  const railZ2 = railZ1.clone()
  railZ2.translate(0, -BLOCK_SIZE * 0.36, 0)
  return mergeGeometries([post, railX1, railX2, railZ1, railZ2])
}

// Bottom half of the cell. Side faces show the bottom half of the texture
// (not the whole texture squashed), like a Minecraft slab.
function _buildSlabGeometry() {
  const geo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE / 2, BLOCK_SIZE)
  geo.translate(0, -BLOCK_SIZE / 4, 0)
  const uv = geo.attributes.uv
  // BoxGeometry faces, 4 vertices each: +x, -x, +y, -y, +z, -z.
  for (const face of [0, 1, 4, 5]) {
    for (let v = face * 4; v < face * 4 + 4; v++) uv.setY(v, uv.getY(v) * 0.5)
  }
  return geo
}

// A door half: a thin panel along the cell's -z edge (rotated per door
// facing, see _doorMatrix). Its big faces show the bottom or top half of
// the 16x32 door texture.
export const DOOR_THICKNESS = BLOCK_SIZE * 3 / 16
function _buildDoorGeometry(top) {
  const geo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, DOOR_THICKNESS)
  geo.translate(0, 0, -BLOCK_SIZE / 2 + DOOR_THICKNESS / 2)
  const uv = geo.attributes.uv
  for (let v = 0; v < uv.count; v++) uv.setY(v, uv.getY(v) * 0.5 + (top ? 0.5 : 0))
  return geo
}

// Game blocks' shapes (BuildGadgets.js). Every one's front is -z, like
// stairs' low side, so facing f turns it toward you.
function _buildPadGeometry() {
  const geo = new THREE.BoxGeometry(BLOCK_SIZE * 14 / 16, BLOCK_SIZE / 16, BLOCK_SIZE * 14 / 16)
  geo.translate(0, -BLOCK_SIZE / 2 + BLOCK_SIZE / 32, 0)
  return geo
}

function _buildChestGeometry() {
  const geo = new THREE.BoxGeometry(BLOCK_SIZE * 14 / 16, BLOCK_SIZE * 14 / 16, BLOCK_SIZE * 14 / 16)
  geo.translate(0, -BLOCK_SIZE / 16, 0)
  return geo
}

// Lever and sign use one picture split in two: the box parts that move or
// carry writing take the top half (uv.y 0.5-1), what they stand on the
// bottom half.
function _halfUV(geo, top) {
  const uv = geo.attributes.uv
  for (let v = 0; v < uv.count; v++) uv.setY(v, uv.getY(v) * 0.5 + (top ? 0.5 : 0))
  return geo
}

function _buildLeverGeometry() {
  const u = BLOCK_SIZE / 16
  const base = _halfUV(new THREE.BoxGeometry(6 * u, 3 * u, 8 * u), false)
  base.translate(0, -BLOCK_SIZE / 2 + 1.5 * u, 0)
  // Tilted toward -z when off; on turns it the other way (BuildGadgets).
  const stick = _halfUV(new THREE.BoxGeometry(2 * u, 9 * u, 2 * u), true)
  stick.translate(0, 4.5 * u, 0)
  stick.rotateX(-0.6)
  stick.translate(0, -BLOCK_SIZE / 2 + 2 * u, 0)
  return mergeGeometries([base.toNonIndexed(), stick.toNonIndexed()])
}

function _buildSignGeometry() {
  const u = BLOCK_SIZE / 16
  const post = _halfUV(new THREE.BoxGeometry(2 * u, 8 * u, 2 * u), false)
  post.translate(0, -BLOCK_SIZE / 2 + 4 * u, 0)
  const board = _halfUV(new THREE.BoxGeometry(14 * u, 8 * u, 1.5 * u), true)
  board.translate(0, -BLOCK_SIZE / 2 + 12 * u, 0)
  return mergeGeometries([post.toNonIndexed(), board.toNonIndexed()])
}

// One half of a 2-wide Train Track (SpecialBlocks 'trainrail'): two
// wooden sleepers right across the cell and one steel rail (foot + head)
// running along it, toward the +x edge - BuildGadgets turns each half so
// its rail sits on the outer side, the pair's rails about a real gauge
// (1.4 blocks) apart. Bottom half
// of the picture (trackPartsCanvas) for the wood, top half for the steel.
function _buildTrackGeometry() {
  const u = BLOCK_SIZE / 16
  const floor = -BLOCK_SIZE / 2
  const parts = []
  for (const z of [-4, 4]) {
    const sleeper = _halfUV(new THREE.BoxGeometry(16 * u, 1.5 * u, 3.5 * u), false)
    sleeper.translate(0, floor + 0.75 * u, z * u)
    parts.push(sleeper.toNonIndexed())
  }
  const foot = _halfUV(new THREE.BoxGeometry(3 * u, 0.5 * u, 16 * u), true)
  foot.translate(3.5 * u, floor + 1.75 * u, 0)
  const head = _halfUV(new THREE.BoxGeometry(1.5 * u, 2 * u, 16 * u), true)
  head.translate(3.5 * u, floor + 3 * u, 0)
  parts.push(foot.toNonIndexed(), head.toNonIndexed())
  return mergeGeometries(parts)
}

function _buildLadderGeometry() {
  const geo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE * 0.12)
  return geo
}

// Keyed by `shape`, not block id - every stair variant (Oak/Stone/Brick/
// Cobblestone) shares this one geometry, same as how every cube block
// already shares blockGeo; only the material/texture differs per type.
// Ladders hang on whichever neighbor is solid, checked in this order.
export const LADDER_SIDES = [[0, -1], [0, 1], [-1, 0], [1, 0]]
// Half the panel's thickness plus a hair, so it sits just off the wall.
export const LADDER_INSET = 0.07
export const CUSTOM_BLOCK_GEOMETRY = {
  slab: _buildSlabGeometry(),
  stairs: _buildStairGeometry(),
  fence: _buildFenceGeometry(),
  ladder: _buildLadderGeometry(),
  door: _buildDoorGeometry(false),
  doortop: _buildDoorGeometry(true),
  pad: _buildPadGeometry(),
  chest: _buildChestGeometry(),
  lever: _buildLeverGeometry(),
  sign: _buildSignGeometry(),
  // Not a shape: picked by a block's `geo` (a pad that looks different).
  track: _buildTrackGeometry(),
}
// Shaped blocks that face a way (saved as `facing`, turned with a copy).
export const FACED_SHAPES = new Set(['stairs', 'chest', 'lever', 'sign', 'cage', 'pad'])
