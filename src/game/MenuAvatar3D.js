// A tiny standalone Three.js scene (its own renderer/camera/lights, not
// the game's main one) that renders a plain blocky Minecraft-style
// character into Player Setup's #setup-avatar-canvas. Deliberately just
// one fixed default look for now - no skin/color picker yet (the player
// plans to supply a real custom skin texture later; this is built so
// swapping the block materials for a textured skin later is a small
// change, not a rewrite).
//
// Auto-spins on its own (a slow full 360 turn on the vertical axis, on
// repeat) whenever the player isn't dragging it - see IDLE_SPIN_SPEED and
// the loop() function. Dragging still works too, but only yaws (turns
// left/right) rather than the old free-trackball pitch+yaw - one axis of
// spin either way, auto or manual, not two.
import * as THREE from 'three'

// Radians/second - a slow, ambient turn, not a fast spinning-coin effect.
// A full 360 takes 2*PI / IDLE_SPIN_SPEED =~ 26 seconds.
const IDLE_SPIN_SPEED = 0.24

// --- Real Minecraft skin PNG support -----------------------------------
//
// A skin file isn't a picture of a character - it's a flattened "unfolded
// box" texture atlas. Every official skin (and every skin exported by
// third-party editors like minecraftskins.com) follows the same fixed
// pixel layout, "modern" 64x64 (adds separate left arm/leg + a hat/
// jacket/sleeve/pants overlay layer) or "legacy" 64x32 (right arm/leg
// only - the left side reuses the right side's pixels, horizontally
// mirrored, since a 32px-tall image has no room for a separate region).
// This project's own character proportions (head 8x8x8, torso 8x12x4,
// each limb 4x12x4) already happen to match Minecraft's real skin-pixel
// dimensions exactly, so no scaling/conversion is needed - only mapping
// each box face to its correct rectangle of the source image.
//
// Overlay layer (hat/jacket/sleeves/pants) is intentionally not
// supported yet - base layer only for this first pass.

// Standard box-UV-unwrap: given a body part's pixel origin (u,v) in the
// skin texture and its block dimensions (w,h,d), returns the pixel rect
// for each of its 6 faces. This exact layout isn't a choice we get to
// make - it's what every skin file's pixels are already arranged as.
function _partFaceRects(u, v, w, h, d) {
  return {
    top: [u + d, v, u + d + w, v + d],
    bottom: [u + d + w, v, u + d + w + w, v + d],
    right: [u, v + d, u + d, v + d + h],
    front: [u + d, v + d, u + d + w, v + d + h],
    left: [u + d + w, v + d, u + d + w + d, v + d + h],
    back: [u + d + w + d, v + d, u + d + w + d + w, v + d + h],
  }
}

// Legacy 64x32 skins only store the right arm/leg - the left side reuses
// those same pixels mirrored horizontally (both the left<->right swap
// and each individual face's own horizontal flip), since flipping a box
// left-to-right swaps which face reads as "left" vs "right".
function _mirrorFaceRectsH(rects, u, w, h, d) {
  const totalW = 2 * w + 2 * d
  const flip = ([u0, v0, u1, v1]) => [2 * u + totalW - u1, v0, 2 * u + totalW - u0, v1]
  return {
    top: flip(rects.top),
    bottom: flip(rects.bottom),
    right: flip(rects.left),
    front: flip(rects.front),
    left: flip(rects.right),
    back: flip(rects.back),
  }
}

// Writes 6 face rects (in source-image pixel space) onto a BoxGeometry's
// UV attribute, matching THREE.BoxGeometry's own fixed face construction
// order (+x, -x, +y, -y, +z, -z) and its default 4-vertices-per-face
// order. faceRects keys map to 3D faces as: right->-x, left->+x,
// top->+y, bottom->-y, front->+z, back->-z (matches the character
// facing +z by default, same as every other part of this file).
//
// Vertex 0/1 of every face are BoxGeometry's own fixed "top" edge in 3D
// space (confirmed by inspecting a fresh BoxGeometry's default position/uv
// attributes directly) and 2/3 are the "bottom" edge - that pairing never
// changes regardless of what UVs get written here. v0/v1 (source-image
// pixel rows, image-space where a SMALLER v is higher up the source
// image) must be assigned to match: the smaller row (v0, visually the top
// of the source pixels) goes on the 3D-top vertices, the larger row (v1,
// the bottom of the source pixels) goes on the 3D-bottom vertices - was
// backwards before (v1 on top/v0 on bottom), which combined with this
// texture's flipY=false (see loadSkinTexture) rendered every face upside
// down. Verified by rendering a two-color test texture (red top half/blue
// bottom half) onto an isolated face and reading back actual pixels
// before/after this swap.
function _applyFaceRectsToBox(geometry, faceRects, texW, texH) {
  const uvAttr = geometry.attributes.uv
  const order = [faceRects.left, faceRects.right, faceRects.top, faceRects.bottom, faceRects.front, faceRects.back]
  for (let face = 0; face < 6; face++) {
    const [u0, v0, u1, v1] = order[face]
    const nu0 = u0 / texW
    const nu1 = u1 / texW
    const nv0 = v0 / texH
    const nv1 = v1 / texH
    const base = face * 4
    uvAttr.setXY(base + 0, nu0, nv0)
    uvAttr.setXY(base + 1, nu1, nv0)
    uvAttr.setXY(base + 2, nu0, nv1)
    uvAttr.setXY(base + 3, nu1, nv1)
  }
  uvAttr.needsUpdate = true
}

// Builds a textured box for one body part, reading its pixels from the
// given origin in the skin image (mirrored for legacy left limbs).
function _texturedBoxMesh(w, h, d, u, v, texture, texW, texH, mirror) {
  let rects = _partFaceRects(u, v, w, h, d)
  if (mirror) rects = _mirrorFaceRectsH(rects, u, w, h, d)
  const geo = new THREE.BoxGeometry(w, h, d)
  _applyFaceRectsToBox(geo, rects, texW, texH)
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }))
}

// Loads a skin PNG into a ready-to-use THREE.Texture - source is either
// a File/Blob (a fresh upload from <input type="file">) or a data URL
// string (a previously-uploaded skin restored from localStorage, see
// Game.js's settings.customSkinDataUrl). Nearest-neighbor filtering
// keeps the pixel art crisp instead of going blurry, and flipY=false so
// pixel coordinates in the helpers above (image space, y increasing
// downward, same as every 2D image format) map directly to UV space
// without a mental flip.
// Every base-layer part has a matching overlay-layer part (hat over
// head, jacket over torso, sleeves over arms, pants over legs) at a
// fixed second location in the texture, same total block size as its
// base counterpart. Real skin editors vary in how much they actually
// use the base vs. the overlay - a genuine real-world file was found
// during testing that puts its ENTIRE visible design on the overlay
// layer, leaving the base layer fully transparent - so the overlay
// can't be treated as optional detail, it has to be composited onto
// the base before UV mapping, the same way Minecraft itself layers
// them (overlay drawn on top, alpha blended, wins wherever it has
// non-transparent pixels). Legacy 64x32 only has room for a head
// overlay (everything else would fall outside the image's 32 rows).
const OVERLAY_ORIGINS = {
  head: [32, 0],
  torso: [16, 32],
  rightArm: [40, 32],
  leftArm: [48, 48],
  rightLeg: [0, 32],
  leftLeg: [0, 48],
}
const PART_DIMS = {
  head: [8, 8, 8],
  torso: [8, 12, 4],
  rightArm: [4, 12, 4],
  leftArm: [4, 12, 4],
  rightLeg: [4, 12, 4],
  leftLeg: [4, 12, 4],
}
const BASE_ORIGINS = {
  head: [0, 0],
  torso: [16, 16],
  rightArm: [40, 16],
  leftArm: [32, 48],
  rightLeg: [0, 16],
  leftLeg: [16, 48],
}

export function loadSkinTexture(source) {
  return new Promise((resolve, reject) => {
    const isBlob = source instanceof Blob
    const url = isBlob ? URL.createObjectURL(source) : source
    const img = new Image()
    img.onload = () => {
      if (isBlob) URL.revokeObjectURL(url)
      const w = img.naturalWidth
      const h = img.naturalHeight
      const legacy = h <= 32

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0)
      for (const part of Object.keys(BASE_ORIGINS)) {
        if (legacy && part !== 'head') continue // no room for other overlays at 32px tall
        const [bw, bh, bd] = PART_DIMS[part]
        const blockW = 2 * bw + 2 * bd
        const blockH = bd + bh
        const [ou, ov] = OVERLAY_ORIGINS[part]
        if (ov + blockH > h) continue // overlay block falls outside the image entirely
        const [bu, bv] = BASE_ORIGINS[part]
        ctx.drawImage(canvas, ou, ov, blockW, blockH, bu, bv, blockW, blockH)
      }

      const texture = new THREE.CanvasTexture(canvas)
      texture.magFilter = THREE.NearestFilter
      texture.minFilter = THREE.NearestFilter
      texture.flipY = false
      texture.colorSpace = THREE.SRGBColorSpace
      texture.needsUpdate = true
      resolve({ texture, width: w, height: h })
    }
    img.onerror = () => {
      if (isBlob) URL.revokeObjectURL(url)
      reject(new Error('Could not load image'))
    }
    img.src = url
  })
}

// The real default-skin.png (public/images/default-skin.png), embedded so
// applying it never needs a network round trip - see the "flash of the
// old flat-color placeholder on reload" fix in Game.js's
// _applyDefaultBundledSkin(), which is the only place this gets used.
// Keep this in sync if that file's contents ever change.
export const DEFAULT_SKIN_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAADDklEQVR4AeyawW7bMAyG5ey++zoMu+xJ1ufunmSXYWh7771w+QmlociuZEeirTQq/IMSKVHkb1pulJxc5u9p/D2WIOP+cHOWgMMjNA6gE2BMcPPuewU0f4uMA+wVYExw8+5PuXd8aQbW/kvj649AjsFv7sEpdKz2kaq7VrmqAoZhmOU3DHPdbNAVKFYRMI6jT+Xl1z8H6KiOdk2wZ9T0l/OVJeDZ3TuFOtM+UnW15N3wZ9fSyhJAYhKUA1///nSANsB27VhFgJSlz5OkAR3V0b4mxLGeJKEhgr/bovNSJ5AwkD4lGs+Z+mJPXupXpQxmgwkhqo8viSF5PvHxzGXLYgX8vxsdWJ5SrsU3UE+0gfb3lIsE7BnA0WstEvDjaXDAKjh8A/VPG2h/TwkBo5SfhyzMs+jLX3TSdX4feP3+4ADPrSj9WLEzdvY8it3PQYZ4n+vkGZ6BcYHe+xSdl6I/k6JPXlvHQ0DS4aVGEg5xqR/redUJIGmClgqZKok2OrXRjoEtRGy36hcTEAZNm0A1YdoK1TEmBmOwh0DHOKQligkgOA2ctuLL470LoXpkPJ4++hBLutBeq+0JYAcG6pQ2WNvXcbFk41TEtlb6ngDLYLQKLNco8W1OABVQEqD1XM4EZ+9leZeu1qUCbP3uE7tZBXDnQ7BYi6hCABsm0ARpLyG2x/14jtotZRUCLAMs9Z2bv3QeMH22l39Esm1ZwJ8PWMk1MaTGSFzJq1dAkp4bMPYKuIGbnEyxV0CSnhsw9gq4gZucTLGpCpBDEA5akwHXNjZFAMntTUIzBJC4fBji32p42A3NEEDyR5DQDAHcckhA7ommCNgzcV3r0xGgia2VFgTwKpsg54tF3+1tnb82cR1nQcD0lZgu0rI0IaDlhOPYTAiQ3dz09wVxEiX9GgSc/V6AYOR97h8D2nJe539bwBE5bdGdjd/6jG8dL+slrxoEJBdo3dgJaP0OWcfXK6AGw/Guv7VfI4ZLffQKuJS5zzKvuALkvbz6twRLY48mspiAoxMoXb8TUMrg0fNL138DAAD//z1dAzYAAAAGSURBVAMALXhjXwvcUWQAAAAASUVORK5CYII='

// A purchasable shop skin preview (public/images/shop-skin-preview.png),
// embedded the same way as DEFAULT_SKIN_DATA_URL above - shown spinning in
// the Shop panel (Game.js's _openShopPanel). Not actually purchasable yet;
// see that method's own comment. Keep this in sync if that file's
// contents ever change.
export const SHOP_SKIN_PREVIEW_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAFE0lEQVR4AexaXWgdRRQ+WehDEUEooj7kQTCKfaj1oSoBrSCKICoGSooVEUXwL7X+pGksxJg2jcRUCoJvFX/ogw+CiEEUKpRCKZRCKKUPLZRCX/rz0lKS+5ObbO+3MMvJ6ezOnZy5d/eWBL6dc2bOnjnnm5m7M9mNyPHX1/t6rIHDfeHNTgKWlmpkw2cf77PWS9vCM3QE4CSgsVynL3dOE0qObw/tuqOOtxvZ0X/hzU4CMKKTBz9sabRhKxE6wx+nzsQhfToJaDSXgAYhg4Wvj0Y39YQkwUmAHFFfHUGHAE8aJITwCR9OAsxaRjkxeqSldQ9bA3QSAiGT5vE4CeAjPjLxmvdvAe+sjHLkesY/uOEJuu+Hd1JA94HLf9GkRHyEbXJ1/Mkkxk+3v0lbXnmBoNvs8ury9gyJ8wIvkVmrWSViQ+Inbl2FmCDL1tTLfUPeniFxWOAlnQF7dh2yrm8e2/rBdfTcry/Ts48dSJA16ln7Blsf3H8RcmSe8d9Mv0tG5mV9+G86NXs0AQLc9urTtLl3U4LnNx603sPv57KtD/gsEukMyBpN1Fc+/4MABHphroIiBdq/3v2TdfagzYXUUUGC9Tcg63nPY5y7fCZRse6/mtzmvT8wfSROCrxYZ0DW8/6vU9sJiQOIGbprhLPaTR/w00nIvqJbC5d6OOQzft3bTxHHkWPP9Bjw+4ws73fpcp8gA5T6zPz5mKP38HjMIe1dunMn6HIg26v1G6SB9NduPTwBtZtUVaDdCUv/4QnothngWoMbZmvEIe2l7lrzrnbpb+DK8ZgDO1IO7FI5uC1kOeJSj5aXGxQa1eb5gUPjvzq/QP33PpAAsi9kwlKPluNFCg10Yg5PkFvx/8XQlDWO2kKF/rl4LgFkX6D/PERLzRkQEo19/cmpEdMUHePs0N83QbKP4Z0zK+pwYJI20H1HXNojhjxEmulp7t3TPEgZOR79Pz034PBkzg04QBkblAe+/4RQulCbr5AGecmjLQgB+2c+WJHM0sh/KQl9m9ejn+TwtPXx6RV2ruTRLkfUV086z7lErazP1dgs7p5NujWHJ2yfj54dIl9fvmte2idB5FwisNwuoF8kDkButZ+x4cNkbH1HXNqj3zxEjcE+0sAEaiv/nXufOIzN+MgvaYKmjpdjUzvS9htDP5MGecmjLbpny0bSAL/UAI63KAEuQ5fYOzm44gkg27n+4sXfSAMkmQf1Vtis6dH9A2STTd3k3t/TdlOXVxr7vOBDtOkJaO4j+PTNknH+z2qz1Rt78++41ZYukqLL7433aGD+D9CuUhMb7nUS4DK429vVS6DbCVojoNtHUBv/2gzQMtjt95dyBvCvQdpNcCkJaNfXIDYyS0VAJ0fekFEqAjo58qUkwATVybJUM6CTiZu+SkFAEWu/VAQUsfZLRYAJJkTp6yP4EpDv9vofnYg5XAH+ORPHHDu2now5XPf7tgcnwDeAou3XCCh6BIruXz0D5JqXCV2vnCYOaf/dWwsxB94kcZh3i6bktpBlf766mgDbf3R96mqNGuH9IQDZF74JS3s9AcrvC2qNOp0+eS0BZF/IhHx1NQH8Lc5qZN8Rl/a+CUt7NQE+091mW1+skwYyIV+9cALkiPrqvglLez0BAX4DfNc9t5cJ+ep6Alp8N2ib/qjzHXFp75uwtFcT8Mj9b5AG+OBaA5mQr64m4OGHXiINxgbOkQa+CUt7NQHSYbfphROA74c00BJ+GwAA//9SzBGoAAAABklEQVQDAGToZHNtSgQHAAAAAElFTkSuQmCC'

// A real uploaded skin - 6 textured boxes at Minecraft's actual skin-
// pixel dimensions (this project's own proportions already match 1:1,
// see the UV support comment above), no hand-crafted hair/face/collar
// extras layered on top since a real skin's texture already carries all
// of that itself.
// Wraps a limb's textured box in its own pivot group, positioned at the
// limb's real-world attachment point (shoulder for arms, hip for legs)
// instead of the box's own geometric center - the box itself is offset
// upward inside the pivot by half its own height so the WORLD position
// of a limb at zero rotation is identical to the flat (non-pivoting)
// version this replaced. A caller that never rotates the returned pivot
// (the homepage preview) renders the exact same static pose as before;
// one that does (MinecraftPlayerBody's walk cycle) swings the limb from
// the correct joint instead of its own center.
function _buildLimbPivot(w, h, d, u, v, texture, texW, texH, mirror, pivotX, pivotY) {
  const mesh = _texturedBoxMesh(w, h, d, u, v, texture, texW, texH, mirror)
  mesh.position.y = -h / 2
  const pivot = new THREE.Group()
  pivot.position.set(pivotX, pivotY, 0)
  pivot.add(mesh)
  return pivot
}

export function buildTexturedCharacter(skin) {
  const { texture, width, height } = skin
  const legacy = height <= 32
  const group = new THREE.Group()

  const head = _texturedBoxMesh(8, 8, 8, 0, 0, texture, width, height, false)
  head.position.y = 26
  group.add(head)

  const torso = _texturedBoxMesh(8, 12, 4, 16, 16, texture, width, height, false)
  torso.position.y = 16
  group.add(torso)

  // x=6, z=0 - flush against the torso (half-width 4) with zero gap and
  // zero overlap. Both alternatives tried here caused a worse visual
  // bug than the one being fixed: pushing the arm back in Z (x=6,z<0)
  // opens a gap that exposes the torso's own side color next to the
  // arm; pulling the arm in on X (x<6) overlaps the torso's geometry
  // and causes z-fighting (flickering interference stripes) wherever
  // the two meshes occupy the same space. x=6/z=0 is the only offset
  // with neither problem - the tradeoff is the arm can eclipse the
  // leg's texture at some profile angles, same as real Minecraft's
  // own non-jointed limb boxes. Shoulder pivot y=22 is the arm's own
  // top edge (was position.y=16, height 12 -> spans 10 to 22); hip
  // pivot y=10 is the leg's own top edge (was position.y=4, height 12
  // -> spans -2 to 10) - see _buildLimbPivot's own comment.
  const armR = _buildLimbPivot(4, 12, 4, 40, 16, texture, width, height, false, 6, 22)
  group.add(armR)
  const armL = legacy
    ? _buildLimbPivot(4, 12, 4, 40, 16, texture, width, height, true, -6, 22)
    : _buildLimbPivot(4, 12, 4, 32, 48, texture, width, height, false, -6, 22)
  group.add(armL)

  const legR = _buildLimbPivot(4, 12, 4, 0, 16, texture, width, height, false, 2, 10)
  group.add(legR)
  const legL = legacy
    ? _buildLimbPivot(4, 12, 4, 0, 16, texture, width, height, true, -2, 10)
    : _buildLimbPivot(4, 12, 4, 16, 48, texture, width, height, false, -2, 10)
  group.add(legL)

  // Exposed for a caller that wants to animate a walk cycle (see
  // MinecraftPlayerBody.js) - each is that limb's OWN pivot, so rotating
  // it directly swings the limb from its real joint. Ignored entirely by
  // a caller that doesn't touch it (the homepage preview).
  group.limbPivots = { armR, armL, legR, legL }
  return group
}

// skin (optional) - {texture, width, height} from loadSkinTexture(), a
// real uploaded skin file. The old hand-built flat-color fallback
// character (grey boxes with a black shirt) has been fully deleted - a
// real user kept seeing it flash briefly on reload/reset even after the
// hide-until-loaded fix below, so rather than fight that timing forever,
// there is now simply no other character it could ever show: no skin
// means an empty, invisible group until a real one (the bundled default,
// an upload, or a shared link) loads in via setSkin().
function buildCharacter(skin) {
  if (skin) return buildTexturedCharacter(skin)
  return new THREE.Group()
}

// Approx character bounding box (see buildCharacter's "skin pixel" units
// above: hair top y=~31.4 down to shoe bottom y=~-2, arms reaching to
// x=+-8) - used by _resize() to keep the camera far enough back to fit
// the WHOLE character regardless of the canvas's aspect ratio, not just
// its height. Bumped slightly (was 16/8) to cover the added hair/shoes.
const CHAR_HALF_HEIGHT = 17
const CHAR_HALF_WIDTH = 8.5
const CHAR_FIT_MARGIN = 0.85 // leaves ~15% breathing room on whichever axis is tightest

export class MenuAvatar3D {
  constructor(canvas, skin) {
    this.canvas = canvas
    // Hidden until the first real setSkin() call (see reveal()/setSkin()
    // below) - the very first character built a few lines down is always
    // the hand-guessed flat-color placeholder (buildCharacter with no skin
    // yet), and briefly showing that before the real default/uploaded skin
    // swaps in read as "the old character flashes on reload." A capped
    // safety timeout guarantees it becomes visible either way, even if
    // whatever call site was supposed to setSkin() never does.
    canvas.style.opacity = '0'
    canvas.style.transition = 'opacity 0.15s ease'
    this._revealed = false
    setTimeout(() => this.reveal(), 600)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene = new THREE.Scene()
    // far=100 used to be plenty for a roughly-square box - now that
    // _resize() can push the camera much further back to fit a very
    // narrow/tall aspect ratio without clipping the character's width,
    // the far plane has to cover that too, or the character silently
    // renders as nothing (clipped past the far plane, not an error).
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 300)
    this.camera.position.set(0, 20, 62)
    this.camera.lookAt(0, 16, 0)

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const key = new THREE.DirectionalLight(0xffffff, 1.1)
    key.position.set(20, 40, 30)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x9fc9ff, 0.4)
    rim.position.set(-20, 10, -30)
    this.scene.add(rim)

    this.character = buildCharacter(skin)
    // Slight starting turn so it doesn't read as a flat front-on sprite -
    // a static angle, not motion, so prefers-reduced-motion needs no
    // special case here.
    this.character.rotation.y = 0.5
    this.scene.add(this.character)

    this._running = false
    this._raf = null
    this._dragging = false
    this._lastFrameTime = 0
    this._resize()
    window.addEventListener('resize', () => this._resize())
    this._bindDrag()
  }

  // Swaps in a new skin (or back to the flat-color default if skin is
  // falsy) without recreating the renderer/camera/lights - just rebuilds
  // the character group. Disposes the old geometries/materials first;
  // the default character's shared skinMat/shirtMat/etc. would double-
  // dispose harmlessly if this is ever called twice in a row with no
  // skin both times, but a textured character's per-part BoxGeometry and
  // MeshStandardMaterial are each unique to that build and would
  // otherwise leak every time the player re-uploads a skin.
  setSkin(skin) {
    const oldRotation = this.character.rotation.y
    this.scene.remove(this.character)
    this.character.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) obj.material.dispose()
    })
    this.character = buildCharacter(skin)
    this.character.rotation.y = oldRotation
    this.scene.add(this.character)
    this.reveal()
  }

  reveal() {
    if (this._revealed) return
    this._revealed = true
    this.canvas.style.opacity = '1'
  }

  // Click-and-drag to spin on the vertical axis only (horizontal drag
  // yaws) - matches the auto-spin's own single axis, so manual and idle
  // rotation never fight each other or leave the character at some
  // half-pitched angle. Pointer Events (not mouse-only) so this also
  // works via touch. Sets _dragging so the idle auto-spin in start()'s
  // loop() pauses itself while the player is actively turning it by hand.
  _bindDrag() {
    let lastX = 0
    this.canvas.style.touchAction = 'none'
    this.canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true
      lastX = e.clientX
      this.canvas.setPointerCapture(e.pointerId)
    })
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this._dragging) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      this.character.rotation.y += dx * 0.02
    })
    const stop = () => { this._dragging = false }
    this.canvas.addEventListener('pointerup', stop)
    this.canvas.addEventListener('pointercancel', stop)
    this.canvas.addEventListener('pointerleave', stop)
  }

  // Reads real layout dimensions live (not a cached window size), so this
  // stays correct through a browser fullscreen toggle or any other resize
  // - and supports a non-square box (the showcase panel uses a tall
  // portrait frame, not the old fixed 84x84 square) by sizing width/height
  // independently instead of forcing both to the same value.
  //
  // The camera's distance is recomputed every resize, not fixed - a fixed
  // distance was tuned for a roughly square box, and once the showcase
  // panel grew into a much taller/narrower portrait, the vertical framing
  // stayed fine (vFOV never changed) but the character's shoulders/arms
  // clipped off the sides, since aspect ratio alone was shrinking the
  // horizontal FOV with nothing compensating. Solving for BOTH the
  // height-fit and width-fit distance and taking whichever is larger
  // guarantees the full character stays in frame no matter how extreme
  // the box's aspect ratio gets.
  _resize() {
    const width = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 112
    const height = this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || width
    this.renderer.setSize(width, height, false)
    const aspect = width / height
    this.camera.aspect = aspect
    const halfVFov = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const distForHeight = (CHAR_HALF_HEIGHT / CHAR_FIT_MARGIN) / Math.tan(halfVFov)
    const distForWidth = (CHAR_HALF_WIDTH / CHAR_FIT_MARGIN) / (Math.tan(halfVFov) * aspect)
    this.camera.position.z = Math.max(distForHeight, distForWidth, 20)
    // Moving along z while x/y stay fixed changes the angle to the look
    // target, so the camera has to re-aim itself - lookAt isn't "sticky"
    // across a later position change, it only orients at call time.
    this.camera.lookAt(0, 16, 0)
    this.camera.updateProjectionMatrix()
  }

  start() {
    if (this._running) return
    this._running = true
    this._lastFrameTime = performance.now()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const loop = (now) => {
      if (!this._running) return
      this._raf = requestAnimationFrame(loop)
      const dt = Math.min((now - this._lastFrameTime) / 1000, 0.1)
      this._lastFrameTime = now
      // Skip actual rendering while the canvas isn't visible (menu hidden
      // during gameplay) - cheap to check, avoids fighting the main
      // game's own render loop for GPU time. _lastFrameTime is still
      // updated above even while skipped, so a long hidden stretch (e.g.
      // a whole run) doesn't come back as one huge dt-driven spin jump.
      if (this.canvas.offsetParent === null) return
      // Idle auto-spin - paused while the player is dragging it themselves
      // (see _bindDrag), and skipped entirely under prefers-reduced-motion
      // (same convention as every other ambient animation in this
      // codebase - ash/embers/rain on the homepage background, etc.).
      if (!this._dragging && !reduceMotion) {
        this.character.rotation.y += IDLE_SPIN_SPEED * dt
      }
      this.renderer.render(this.scene, this.camera)
    }
    this._raf = requestAnimationFrame(loop)
  }

  stop() {
    this._running = false
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = null
  }
}
