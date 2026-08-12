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
    uvAttr.setXY(base + 0, nu0, nv1)
    uvAttr.setXY(base + 1, nu1, nv1)
    uvAttr.setXY(base + 2, nu0, nv0)
    uvAttr.setXY(base + 3, nu1, nv0)
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

// Classic Minecraft player proportions (in arbitrary "skin pixel" units,
// same 8/12/12 head/torso-and-arms/legs split the real game uses) so the
// silhouette reads as instantly recognizable. This is the DEFAULT skin
// every new player gets (no skin-customization system exists yet) -
// colors match a real skin file the player built at minecraftskins.com's
// skin editor and shared as clean full-resolution screenshots (front +
// side views), with the exact hex values called out directly: #929292
// (gray body), #000000 (hair/vest/pants), #1f1f1f (a slightly lighter
// dark accent on the pants - close enough to the black main pants color
// that it's skipped here rather than added as its own tiny stripe),
// #ffffff (eyes + a "G" chest logo), #d72323 (nose). The chest logo
// itself can't be reproduced - this character is solid-color boxes, not
// a textured/UV-mapped model, so there's no surface to put a letter on.
const SKIN_TONE = 0x929292
const SHIRT_COLOR = 0x000000
const SHIRT_ACCENT_COLOR = 0x929292
const PANTS_COLOR = 0x000000
const EYE_WHITE_COLOR = 0xffffff
const EYE_PUPIL_COLOR = 0x000000
const HAIR_COLOR = 0x000000
const MOUTH_COLOR = 0x000000
const NOSE_COLOR = 0xd72323
const SHOE_COLOR = 0x929292

// A real uploaded skin - 6 textured boxes at Minecraft's actual skin-
// pixel dimensions (this project's own proportions already match 1:1,
// see the UV support comment above), no hand-crafted hair/face/collar
// extras layered on top since a real skin's texture already carries all
// of that itself.
function buildTexturedCharacter(skin) {
  const { texture, width, height } = skin
  const legacy = height <= 32
  const group = new THREE.Group()

  const head = _texturedBoxMesh(8, 8, 8, 0, 0, texture, width, height, false)
  head.position.y = 26
  group.add(head)

  const torso = _texturedBoxMesh(8, 12, 4, 16, 16, texture, width, height, false)
  torso.position.y = 16
  group.add(torso)

  const armR = _texturedBoxMesh(4, 12, 4, 40, 16, texture, width, height, false)
  armR.position.set(6, 16, 0)
  group.add(armR)
  const armL = legacy
    ? _texturedBoxMesh(4, 12, 4, 40, 16, texture, width, height, true)
    : _texturedBoxMesh(4, 12, 4, 32, 48, texture, width, height, false)
  armL.position.set(-6, 16, 0)
  group.add(armL)

  const legR = _texturedBoxMesh(4, 12, 4, 0, 16, texture, width, height, false)
  legR.position.set(2, 4, 0)
  group.add(legR)
  const legL = legacy
    ? _texturedBoxMesh(4, 12, 4, 0, 16, texture, width, height, true)
    : _texturedBoxMesh(4, 12, 4, 16, 48, texture, width, height, false)
  legL.position.set(-2, 4, 0)
  group.add(legL)

  return group
}

// skin (optional) - {texture, width, height} from loadSkinTexture(), a
// real uploaded skin file. Without one, falls back to the original
// hand-built flat-color character (today's default look for anyone who
// hasn't uploaded a skin).
function buildCharacter(skin) {
  if (skin) return buildTexturedCharacter(skin)

  const group = new THREE.Group()

  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN_TONE, roughness: 0.85 })
  const shirtMat = new THREE.MeshStandardMaterial({ color: SHIRT_COLOR, roughness: 0.8 })
  const shirtAccentMat = new THREE.MeshStandardMaterial({ color: SHIRT_ACCENT_COLOR, roughness: 0.7 })
  const pantsMat = new THREE.MeshStandardMaterial({ color: PANTS_COLOR, roughness: 0.85 })
  const hairMat = new THREE.MeshStandardMaterial({ color: HAIR_COLOR, roughness: 0.9 })
  const shoeMat = new THREE.MeshStandardMaterial({ color: SHOE_COLOR, roughness: 0.8 })

  const head = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), skinMat)
  head.position.y = 26
  group.add(head)

  // Short, neutral hair cap - a slightly wider/taller box sitting over the
  // top-back of the head, not full coverage (leaves the face clear), so it
  // reads as hair rather than a helmet.
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(8.4, 2, 8.4), hairMat)
  hairTop.position.set(0, 30.4, 0)
  group.add(hairTop)
  const hairBack = new THREE.Mesh(new THREE.BoxGeometry(8.4, 6, 2.4), hairMat)
  hairBack.position.set(0, 28, -2.9)
  group.add(hairBack)

  // White eyes with a black pupil square in the corner (the reference
  // skin only uses white + black for the eyes, no separate iris tone -
  // simpler than the previous 3-layer white/iris/pupil version).
  const eyeWhiteGeo = new THREE.BoxGeometry(1.6, 1.6, 0.16)
  const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: EYE_WHITE_COLOR })
  const pupilGeo = new THREE.BoxGeometry(0.55, 0.55, 0.2)
  const pupilMat = new THREE.MeshBasicMaterial({ color: EYE_PUPIL_COLOR })
  for (const side of [-1, 1]) {
    const x = side * 1.9
    const eyeWhite = new THREE.Mesh(eyeWhiteGeo, eyeWhiteMat)
    eyeWhite.position.set(x, 26.6, 4.02)
    group.add(eyeWhite)
    const pupil = new THREE.Mesh(pupilGeo, pupilMat)
    pupil.position.set(x, 26.4, 4.12)
    group.add(pupil)
  }
  // Red nose square between the eyes - a real facial feature in the
  // reference skin, not something the character had before.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 0.2), new THREE.MeshBasicMaterial({ color: NOSE_COLOR }))
  nose.position.set(0, 25.6, 4.05)
  group.add(nose)
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.2), new THREE.MeshBasicMaterial({ color: MOUTH_COLOR }))
  mouth.position.set(0, 23.8, 4.05)
  group.add(mouth)

  const torso = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 4), shirtMat)
  torso.position.y = 16
  group.add(torso)

  // White collar/undershirt patch at the neckline, matching the reference
  // image's light-colored band across the top of the near-black shirt.
  const collar = new THREE.Mesh(new THREE.BoxGeometry(8.1, 1.6, 4.1), shirtAccentMat)
  collar.position.y = 21.2
  group.add(collar)

  const armGeo = new THREE.BoxGeometry(4, 12, 4)
  const armL = new THREE.Mesh(armGeo, skinMat)
  armL.position.set(-6, 16, 0)
  group.add(armL)
  const armR = new THREE.Mesh(armGeo, skinMat)
  armR.position.set(6, 16, 0)
  group.add(armR)

  const legGeo = new THREE.BoxGeometry(4, 12, 4)
  const legL = new THREE.Mesh(legGeo, pantsMat)
  legL.position.set(-2, 4, 0)
  group.add(legL)
  const legR = new THREE.Mesh(legGeo, pantsMat)
  legR.position.set(2, 4, 0)
  group.add(legR)

  // Shoes - a short, slightly wider cap at the bottom of each leg, the
  // one other small detail real Minecraft-style skins almost always have
  // that the original bare pants-colored box was missing entirely.
  const shoeGeo = new THREE.BoxGeometry(4.3, 2.4, 4.3)
  const shoeL = new THREE.Mesh(shoeGeo, shoeMat)
  shoeL.position.set(-2, -0.8, 0.15)
  group.add(shoeL)
  const shoeR = new THREE.Mesh(shoeGeo, shoeMat)
  shoeR.position.set(2, -0.8, 0.15)
  group.add(shoeR)

  return group
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
