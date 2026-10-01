// Inventory's Inspect window (Kirka-style): one item shown big in 3D -
// drag to turn it any way, scroll (or pinch) to zoom, and it slowly spins
// on its own while nobody is touching it. Its own small renderer on its
// own canvas, created when the window opens and fully disposed (context
// released) when it closes, so it never holds a WebGL context or fights
// the game's renderer while it isn't on screen.
//
// The shown object is the caller's: a weapon is a clone of its viewmodel
// (sharing the game's geometries/materials, so they are never disposed
// here), a character is built fresh by the caller and disposed by it.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

const IDLE_SPIN_SPEED = 0.45 // radians per second
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2.2

export class InspectViewer {
  constructor(canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x000000, 0)
    this.scene = new THREE.Scene()
    // Metal guns only show what they reflect - without an environment
    // they render black (same reason as the weapon card pictures).
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this._envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    this.scene.environment = this._envTexture
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a9a, 2.2))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(3, 4, 5)
    this.scene.add(key)
    const rim = new THREE.DirectionalLight(0xffffff, 1)
    rim.position.set(-3, 2, -4)
    this.scene.add(rim)
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 1000)
    // The object sits inside a pivot centred on its own bounds, so turning
    // the pivot spins it in place rather than around some far-off origin.
    this.pivot = new THREE.Group()
    this.scene.add(this.pivot)
    this.object = null
    this._fitDistance = 5
    this._zoom = 1
    this._dragging = false
    this._lastInput = 0
    this._raf = null
    this._last = 0
    this._onResize = () => this._resize()
    window.addEventListener('resize', this._onResize)
    this._bindInput()
    this._resize()
  }

  // yaw: the starting turn (a gun side-on reads best, a character a
  // little off front-on).
  setObject(object, { yaw = 0, pitch = 0 } = {}) {
    if (this.object) this.pivot.remove(this.object)
    this.object = object
    this.pivot.rotation.set(pitch, yaw, 0)
    this._zoom = 1
    if (!object) return
    object.updateMatrixWorld(true)
    // Bounds of what's actually visible (hidden alternate parts would
    // otherwise stretch the framing).
    const box = new THREE.Box3()
    const meshBox = new THREE.Box3()
    object.traverse((o) => {
      if (!o.isMesh || !o.geometry) return
      for (let p = o; p; p = p.parent) if (!p.visible) return
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
      meshBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)
      box.union(meshBox)
    })
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1))
    const center = box.getCenter(new THREE.Vector3())
    object.position.sub(center)
    this.pivot.add(object)
    // Framed by its height, and by its widest extent while spinning
    // around the vertical axis (so a long gun fills the wide window).
    const size = box.getSize(new THREE.Vector3())
    this._halfY = size.y / 2
    this._radiusXZ = Math.hypot(size.x, size.z) / 2
    // Opens at the starting angle; the idle spin waits a moment.
    this._lastInput = performance.now()
    this._resize()
  }

  _bindInput() {
    const c = this.canvas
    c.style.touchAction = 'none'
    const pointers = new Map()
    let pinchStart = 0
    let zoomStart = 1
    c.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      c.setPointerCapture(e.pointerId)
      this._dragging = true
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y)
        zoomStart = this._zoom
      }
    })
    c.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId)
      if (!prev) return
      const dx = e.clientX - prev.x
      const dy = e.clientY - prev.y
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      this._lastInput = performance.now()
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchStart > 0) this._setZoom(zoomStart * (dist / pinchStart))
        return
      }
      this.pivot.rotation.y += dx * 0.012
      this.pivot.rotation.x = THREE.MathUtils.clamp(this.pivot.rotation.x + dy * 0.012, -1.3, 1.3)
    })
    const up = (e) => {
      pointers.delete(e.pointerId)
      if (!pointers.size) this._dragging = false
    }
    c.addEventListener('pointerup', up)
    c.addEventListener('pointercancel', up)
    c.addEventListener('wheel', (e) => {
      e.preventDefault()
      this._lastInput = performance.now()
      this._setZoom(this._zoom * Math.exp(-e.deltaY * 0.0015))
    }, { passive: false })
  }

  _setZoom(z) {
    this._zoom = THREE.MathUtils.clamp(z, MIN_ZOOM, MAX_ZOOM)
    this._placeCamera()
  }

  _resize() {
    const width = this.canvas.clientWidth || 600
    const height = this.canvas.clientHeight || 400
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    const halfV = THREE.MathUtils.degToRad(this.camera.fov) / 2
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect)
    const r = Math.max(this._radiusXZ || 1, this._halfY || 1)
    this._fitDistance = Math.max((this._radiusXZ || 1) / Math.tan(halfH), (this._halfY || 1) / Math.tan(halfV)) * 1.18 + (this._radiusXZ || 1)
    this.camera.near = Math.max(r / 100, 0.001)
    this.camera.far = r * 100
    this.camera.updateProjectionMatrix()
    this._placeCamera()
  }

  _placeCamera() {
    this.camera.position.set(0, 0, this._fitDistance / this._zoom)
    this.camera.lookAt(0, 0, 0)
  }

  start() {
    if (this._raf) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    this._last = performance.now()
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop)
      const dt = Math.min((now - this._last) / 1000, 0.1)
      this._last = now
      // Resumes spinning a moment after the player lets go.
      if (!this._dragging && !reduceMotion && now - this._lastInput > 1500) {
        this.pivot.rotation.y += IDLE_SPIN_SPEED * dt
      }
      this.renderer.render(this.scene, this.camera)
    }
    this._raf = requestAnimationFrame(loop)
  }

  dispose() {
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = null
    window.removeEventListener('resize', this._onResize)
    if (this.object) this.pivot.remove(this.object)
    this.object = null
    this._envTexture.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}
