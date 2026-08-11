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

// Classic Minecraft player proportions (in arbitrary "skin pixel" units,
// same 8/12/12 head/torso-and-arms/legs split the real game uses) so the
// silhouette reads as instantly recognizable. This is the DEFAULT skin
// every new player gets (no skin-customization system exists yet) - a few
// extra low-poly details (hair, a mouth, shoes) on top of the original
// bare boxes give it more presence without adding real complexity/cost,
// still just flat-shaded boxes, no new geometry types or textures.
const SKIN_TONE = 0xd9a066
const SHIRT_COLOR = 0x4fb3b3
const PANTS_COLOR = 0x3c4a8a
const EYE_COLOR = 0x1a1a1a
const HAIR_COLOR = 0x3b2a1e
const MOUTH_COLOR = 0x8a5a4a
const SHOE_COLOR = 0x2b2320

function buildCharacter() {
  const group = new THREE.Group()

  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN_TONE, roughness: 0.85 })
  const shirtMat = new THREE.MeshStandardMaterial({ color: SHIRT_COLOR, roughness: 0.85 })
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

  // Simple flat eyes + a mouth line on the head's front face - just enough
  // to read as a face at this size, not a real textured skin.
  const eyeGeo = new THREE.BoxGeometry(1.2, 1.2, 0.2)
  const eyeMat = new THREE.MeshBasicMaterial({ color: EYE_COLOR })
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
  eyeL.position.set(-1.8, 26.5, 4.05)
  group.add(eyeL)
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
  eyeR.position.set(1.8, 26.5, 4.05)
  group.add(eyeR)
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 0.2), new THREE.MeshBasicMaterial({ color: MOUTH_COLOR }))
  mouth.position.set(0, 23.8, 4.05)
  group.add(mouth)

  const torso = new THREE.Mesh(new THREE.BoxGeometry(8, 12, 4), shirtMat)
  torso.position.y = 16
  group.add(torso)

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
  constructor(canvas) {
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

    this.character = buildCharacter()
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
