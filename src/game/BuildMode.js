// Standalone block-placing creative sandbox - explicitly NOT connected to
// zombie survival gameplay (see docs/superpowers/specs/2026-08-08-build-mode-design.md).
// Reuses Game.js's existing renderer/canvas rather than a second WebGL
// context - only the scene/camera passed to render() changes.
import * as THREE from 'three'

const GROUND_SIZE = 64
const BLOCK_SIZE = 1
const FLY_SPEED = 8
const LOOK_SENSITIVITY = 0.0022
const MAX_INSTANCES_PER_TYPE = 4096
const SAVE_KEY = 'gayz-build-mode'

export const BLOCK_TYPES = [
  { id: 'concrete', color: 0x9a9a92 },
  { id: 'brick', color: 0xa8503a },
  { id: 'wood', color: 0x8a5a34 },
  { id: 'metal', color: 0xb0b8bd },
  { id: 'grass', color: 0x5fa84a },
  { id: 'dirt', color: 0x6b4a30 },
  { id: 'glass', color: 0xaee0e8 },
  { id: 'asphalt', color: 0x3a3a3c },
  { id: 'stone', color: 0x808078 },
]
const VALID_TYPE_IDS = new Set(BLOCK_TYPES.map((b) => b.id))

export class BuildMode {
  constructor(renderer) {
    this.renderer = renderer
    this.active = false

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x87ceeb)

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2)
    this.scene.add(hemiLight)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.0)
    sunLight.position.set(20, 30, 10)
    this.scene.add(sunLight)

    const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE)
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x6b8f4e })
    this.ground = new THREE.Mesh(groundGeo, groundMat)
    this.ground.rotation.x = -Math.PI / 2
    this.scene.add(this.ground)

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500)
    this.camera.position.set(0, 5, 10)

    // Free-fly input state - WASD + Space/Shift for up/down, mouse look
    // while pointer-locked. No gravity, no collision (see spec's "why this
    // shape" section).
    this._keys = new Set()
    this._yaw = 0
    this._pitch = 0
    this._onKeyDown = (e) => this._keys.add(e.code)
    this._onKeyUp = (e) => this._keys.delete(e.code)
    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return
      this._yaw -= e.movementX * LOOK_SENSITIVITY
      this._pitch -= e.movementY * LOOK_SENSITIVITY
      this._pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this._pitch))
    }

    // One InstancedMesh per block type (not one Mesh per block) - keeps the
    // scene graph at a fixed 9 objects regardless of how many blocks are
    // placed, avoiding this project's own documented CPU-bound-on-scene-
    // graph-traversal bottleneck (see docs/PERFORMANCE.md).
    this.selectedType = BLOCK_TYPES[0].id
    this._blocks = new Map() // "x,y,z" -> type id
    this._instancedMeshes = {}
    this._instanceKeyByIndex = {} // type id -> array mapping instance index -> "x,y,z" key, for swap-remove
    const blockGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE)
    for (const { id, color } of BLOCK_TYPES) {
      const mesh = new THREE.InstancedMesh(blockGeo, new THREE.MeshStandardMaterial({ color }), MAX_INSTANCES_PER_TYPE)
      mesh.count = 0
      this.scene.add(mesh)
      this._instancedMeshes[id] = mesh
      this._instanceKeyByIndex[id] = []
    }

    this._raycaster = new THREE.Raycaster()
    this._onPointerDown = (e) => {
      if (document.pointerLockElement !== this.renderer.domElement) return
      if (e.button === 0) this._placeFromCamera()
      else if (e.button === 2) this._removeFromCamera()
    }
    this._onContextMenu = (e) => { if (this.active) e.preventDefault() }

    // Tab picker overlay - a plain DOM grid (not part of the 3D scene) of
    // the 9 block types, toggled with Tab.
    this.pickerOpen = false
    this._pickerEl = document.getElementById('build-picker')
    this._renderPicker()
    this._onKeyDownPicker = (e) => {
      if (e.code === 'Tab') {
        e.preventDefault()
        this.togglePicker()
      } else if (e.code === 'Escape' && this.pickerOpen) {
        this.togglePicker()
      }
    }
  }

  enter() {
    this.active = true
    window.addEventListener('keydown', this._onKeyDown)
    window.addEventListener('keyup', this._onKeyUp)
    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('keydown', this._onKeyDownPicker)
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown)
    window.addEventListener('contextmenu', this._onContextMenu)
    this.load()
  }

  exit() {
    this.save()
    this.active = false
    this._keys.clear()
    window.removeEventListener('keydown', this._onKeyDown)
    window.removeEventListener('keyup', this._onKeyUp)
    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('keydown', this._onKeyDownPicker)
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown)
    window.removeEventListener('contextmenu', this._onContextMenu)
    this.pickerOpen = false
    if (this._pickerEl) this._pickerEl.style.display = 'none'
  }

  _key(x, y, z) {
    return `${x},${y},${z}`
  }

  getBlockAt(x, y, z) {
    return this._blocks.get(this._key(x, y, z)) ?? null
  }

  placeBlock(x, y, z, type) {
    const key = this._key(x, y, z)
    if (this._blocks.has(key)) return
    const mesh = this._instancedMeshes[type]
    if (!mesh || mesh.count >= MAX_INSTANCES_PER_TYPE) return
    const index = mesh.count
    const matrix = new THREE.Matrix4().makeTranslation(x + 0.5, y + 0.5, z + 0.5)
    mesh.setMatrixAt(index, matrix)
    mesh.count++
    mesh.instanceMatrix.needsUpdate = true
    this._blocks.set(key, type)
    this._instanceKeyByIndex[type][index] = key
  }

  removeBlock(x, y, z) {
    const key = this._key(x, y, z)
    const type = this._blocks.get(key)
    if (!type) return
    const mesh = this._instancedMeshes[type]
    const keys = this._instanceKeyByIndex[type]
    const removedIndex = keys.indexOf(key)
    const lastIndex = mesh.count - 1
    if (removedIndex !== lastIndex) {
      // Swap-remove: move the last instance's transform into the removed
      // slot, then shrink count - InstancedMesh has no native "delete at
      // index", this is the standard technique.
      const lastMatrix = new THREE.Matrix4()
      mesh.getMatrixAt(lastIndex, lastMatrix)
      mesh.setMatrixAt(removedIndex, lastMatrix)
      keys[removedIndex] = keys[lastIndex]
    }
    keys.pop()
    mesh.count--
    mesh.instanceMatrix.needsUpdate = true
    this._blocks.delete(key)
  }

  _placeFromCamera() {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (!hit) return
    const [px, py, pz] = hit.placeAt
    this.placeBlock(px, py, pz, this.selectedType)
  }

  _removeFromCamera() {
    this._raycaster.setFromCamera({ x: 0, y: 0 }, this.camera)
    const hit = this._raycastGridAligned()
    if (!hit || !hit.existingBlock) return
    const [rx, ry, rz] = hit.existingBlock
    this.removeBlock(rx, ry, rz)
  }

  // Steps a ray forward in fixed small increments and checks the sparse
  // block map at each grid cell - simpler and more robust for a uniform
  // grid than THREE's mesh-based raycasting against InstancedMesh (which
  // needs per-instance bounding data this project doesn't otherwise need).
  _raycastGridAligned() {
    const origin = this._raycaster.ray.origin
    const dir = this._raycaster.ray.direction
    const maxDist = 40
    const step = 0.1
    let prevCell = null
    for (let t = 0; t < maxDist; t += step) {
      const px = origin.x + dir.x * t
      const py = origin.y + dir.y * t
      const pz = origin.z + dir.z * t
      const cell = [Math.floor(px), Math.floor(py), Math.floor(pz)]
      if (py <= 0) {
        // Hit the ground plane before hitting any block.
        return prevCell ? { placeAt: prevCell, existingBlock: null } : { placeAt: cell, existingBlock: null }
      }
      if (this.getBlockAt(cell[0], cell[1], cell[2])) {
        return { placeAt: prevCell || cell, existingBlock: cell }
      }
      prevCell = cell
    }
    return null
  }

  _renderPicker() {
    if (!this._pickerEl) return
    this._pickerEl.innerHTML = ''
    for (const { id, color } of BLOCK_TYPES) {
      const swatch = document.createElement('div')
      swatch.className = 'build-picker-swatch' + (id === this.selectedType ? ' selected' : '')
      swatch.style.background = `#${color.toString(16).padStart(6, '0')}`
      swatch.addEventListener('click', () => {
        this.selectedType = id
        this.togglePicker()
      })
      this._pickerEl.appendChild(swatch)
    }
  }

  togglePicker() {
    this.pickerOpen = !this.pickerOpen
    if (this._pickerEl) this._pickerEl.style.display = this.pickerOpen ? 'grid' : 'none'
    if (this.pickerOpen) this._renderPicker()
    if (document.pointerLockElement === this.renderer.domElement && this.pickerOpen) {
      document.exitPointerLock()
    } else if (!this.pickerOpen) {
      // See _enterBuildMode's own comment on why this is guarded - fails
      // in headless/programmatically-triggered contexts, harmless to swallow.
      try {
        this.renderer.domElement.requestPointerLock()?.catch(() => {})
      } catch {
        // Not available in this environment.
      }
    }
  }

  save() {
    const entries = []
    for (const [key, type] of this._blocks) {
      const [x, y, z] = key.split(',').map(Number)
      entries.push({ x, y, z, type })
    }
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(entries))
    } catch {
      // Storage unavailable (e.g. private browsing) - build just won't persist.
    }
  }

  load() {
    let raw
    try {
      raw = localStorage.getItem(SAVE_KEY)
    } catch {
      return
    }
    if (!raw) return
    let entries
    try {
      entries = JSON.parse(raw)
    } catch {
      return
    }
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue
      const { x, y, z, type } = entry
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
      if (!VALID_TYPE_IDS.has(type)) continue
      this.placeBlock(Math.trunc(x), Math.trunc(y), Math.trunc(z), type)
    }
  }

  update(dt) {
    this.camera.rotation.set(0, 0, 0)
    this.camera.rotateY(this._yaw)
    this.camera.rotateX(this._pitch)

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion)
    const move = new THREE.Vector3()
    if (this._keys.has('KeyW')) move.add(forward)
    if (this._keys.has('KeyS')) move.sub(forward)
    if (this._keys.has('KeyD')) move.add(right)
    if (this._keys.has('KeyA')) move.sub(right)
    if (this._keys.has('Space')) move.y += 1
    if (this._keys.has('ShiftLeft')) move.y -= 1
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(FLY_SPEED * dt)
      this.camera.position.add(move)
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }
}
