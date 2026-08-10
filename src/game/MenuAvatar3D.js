// A tiny standalone Three.js scene (its own renderer/camera/lights, not
// the game's main one) that renders a plain blocky Minecraft-style
// character into the homepage avatar canvas (#menu-avatar-photo).
// Deliberately just one fixed default look for now - no skin/color
// picker yet (the player plans to supply a real custom skin texture
// later; this is built so swapping the block materials for a textured
// skin later is a small change, not a rewrite).
import * as THREE from 'three'

// Classic Minecraft player proportions (in arbitrary "skin pixel" units,
// same 8/12/12 head/torso-and-arms/legs split the real game uses) so the
// silhouette reads as instantly recognizable.
const SKIN_TONE = 0xd9a066
const SHIRT_COLOR = 0x4fb3b3
const PANTS_COLOR = 0x3c4a8a
const EYE_COLOR = 0x1a1a1a

function buildCharacter() {
  const group = new THREE.Group()

  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN_TONE, roughness: 0.85 })
  const shirtMat = new THREE.MeshStandardMaterial({ color: SHIRT_COLOR, roughness: 0.85 })
  const pantsMat = new THREE.MeshStandardMaterial({ color: PANTS_COLOR, roughness: 0.85 })

  const head = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), skinMat)
  head.position.y = 26
  group.add(head)

  // Simple flat eyes on the head's front face - just enough to read as a
  // face at this size, not a real textured skin.
  const eyeGeo = new THREE.BoxGeometry(1.2, 1.2, 0.2)
  const eyeMat = new THREE.MeshBasicMaterial({ color: EYE_COLOR })
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat)
  eyeL.position.set(-1.8, 26.5, 4.05)
  group.add(eyeL)
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat)
  eyeR.position.set(1.8, 26.5, 4.05)
  group.add(eyeR)

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

  return group
}

export class MenuAvatar3D {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
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
    this.scene.add(this.character)

    this._reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (this._reduceMotion) this.character.rotation.y = 0.5

    this._running = false
    this._raf = null
    this._resize()
    window.addEventListener('resize', () => this._resize())
  }

  _resize() {
    const size = this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 112
    this.renderer.setSize(size, size, false)
    this.camera.aspect = 1
    this.camera.updateProjectionMatrix()
  }

  start() {
    if (this._running) return
    this._running = true
    const loop = () => {
      if (!this._running) return
      this._raf = requestAnimationFrame(loop)
      // Skip actual rendering while the canvas isn't visible (menu hidden
      // during gameplay) - cheap to check, avoids fighting the main
      // game's own render loop for GPU time.
      if (this.canvas.offsetParent === null) return
      if (!this._reduceMotion) this.character.rotation.y += 0.006
      this.renderer.render(this.scene, this.camera)
    }
    loop()
  }

  stop() {
    this._running = false
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = null
  }
}
