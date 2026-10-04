// Build Together (2026-10-04): build the same map live with friends.
// Owned by BuildMode (`buildMode.together`). The host starts a room from
// the open map and gets a 6-letter code; friends type the code to join
// (signed-in Cloud Save accounts, like everything online here). Joiners
// get the host's map in their Shared Map slot, so nobody's own slots are
// touched.
//
// What syncs: every block placed or broken (single clicks, fills, shapes,
// pastes, undo and redo - they all come through the undo history, see
// BuildMode._recordUndo), doors opening/closing, levers, and sign words.
// Flowing water/lava isn't sent - each player's game flows it from the
// same sources. Changes go out in small batches a fraction of a second
// apart (an edit doc each, Firestore's buildRooms/{code}/edits), and each
// player's spot goes out about once a second, shown to the others as a
// blocky figure with a name tag.
//
// Like the rest of this game's online parts there's no server of our own,
// so a change made by two people in the same cell at the same moment ends
// up as whichever arrives last.
import * as THREE from 'three'
import * as CloudSync from './CloudSync.js'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { t } from './i18n.js'

export const SEND_DELAY_MS = 300
export const OPS_PER_EDIT = 1500
const PRESENCE_MS = 1000
const PRESENCE_TIMEOUT_MS = 15000
const CODE_RE = /^[A-Z0-9]{6}$/
const MAX_COORD = 512

export class BuildTogether {
  constructor(buildMode, blockSize) {
    this.bm = buildMode
    this.B = blockSize
    this.active = false
    this.code = null
    this.isHost = false
    this._pending = []
    this._seen = new Set()
    this._others = new Map() // uid -> { group, label, target, name, at }
    this.applyingRemote = false
    this.panel = document.getElementById('build-together-panel')
    this.chip = document.getElementById('build-together-chip')
    if (!this.panel) return
    this.codeInput = document.getElementById('build-together-code')
    this.panel.addEventListener('keydown', (e) => e.stopPropagation())
    this.panel.addEventListener('click', (e) => {
      if (e.target === this.panel) this.closePanel()
    })
    this.codeInput?.addEventListener('input', () => {
      this.codeInput.value = this.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
    })
    document.getElementById('build-together-host-btn')?.addEventListener('click', () => this.host())
    document.getElementById('build-together-join-btn')?.addEventListener('click', () => this.join(this.codeInput.value))
    document.getElementById('build-together-leave-btn')?.addEventListener('click', () => this.leave())
    document.getElementById('build-together-close-btn')?.addEventListener('click', () => this.closePanel())
    document.getElementById('build-together-copy-btn')?.addEventListener('click', () => {
      if (this.code) navigator.clipboard?.writeText(this.code).catch(() => {})
      this._toast(t('shareCodeCopied'))
    })
  }

  api() {
    return this.bm.game?.__buildRoomBackendForTests || CloudSync
  }

  _uid() {
    return this.bm.game?._cloudUid || null
  }

  _name() {
    return (this.bm.game?.settings?.nickname || 'Player').slice(0, 24)
  }

  _toast(text) {
    this.bm.game?._showHomepageToast?.(text)
  }

  openPanel() {
    if (!this.panel) return
    if (this.bm.menuOpen) this.bm.toggleMenu()
    if (document.pointerLockElement) document.exitPointerLock()
    this.panel.style.display = 'flex'
    this._renderPanel()
  }

  closePanel() {
    if (this.panel) this.panel.style.display = 'none'
  }

  get isOpen() {
    return !!this.panel && this.panel.style.display === 'flex'
  }

  _renderPanel() {
    const set = (id, text) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    const show = (id, on) => {
      const el = document.getElementById(id)
      if (el) el.style.display = on ? '' : 'none'
    }
    set('build-together-status', this.active ? t(this.isHost ? 'togetherHosting' : 'togetherJoined', { code: this.code }) : t('togetherIntro'))
    show('build-together-start', !this.active)
    show('build-together-in-room', this.active)
    set('build-together-room-code', this.code || '')
    const people = document.getElementById('build-together-people')
    if (people) {
      const names = [this._name(), ...[...this._others.values()].map((o) => o.name)]
      people.textContent = this.active ? t('togetherPeople', { names: names.join(', ') }) : ''
    }
    if (this.chip) {
      this.chip.style.display = this.active && this.bm.active ? 'block' : 'none'
      this.chip.textContent = this.active ? t('togetherChip', { code: this.code, n: this._others.size + 1 }) : ''
    }
  }

  // Start a room from the open map.
  async host() {
    const uid = this._uid()
    if (!uid) return this._toast(t('shareSignInRequired'))
    if (this.active) await this.leave()
    const { base, data } = this.bm._shareData()
    if (data.length > 900000) return this._toast(t('shareTooLarge'))
    const res = await this.api().createBuildRoom(uid, this._name(), this.bm._slotName().slice(0, 30), base, data).catch(() => null)
    if (!res?.ok) return this._toast(t('shareFailed'))
    this.isHost = true
    this._start(res.code)
    return res.code
  }

  // Join a friend's room by its code.
  async join(rawCode) {
    const uid = this._uid()
    if (!uid) return this._toast(t('shareSignInRequired'))
    const code = String(rawCode || '').toUpperCase().trim()
    if (!CODE_RE.test(code)) return this._toast(t('shareBadCode'))
    const room = await this.api().fetchBuildRoom(code).catch(() => null)
    if (!room || typeof room.data !== 'string') return this._toast(t('togetherNotFound'))
    if (this.active) await this.leave()
    if (!this.bm.loadSharedData(room.base, room.data, { name: room.name, creatorNickname: room.hostName, code: null })) return this._toast(t('togetherNotFound'))
    this.isHost = false
    this._start(code)
    return code
  }

  _start(code) {
    this.active = true
    this.code = code
    this._seen.clear()
    this._pending = []
    const uid = this._uid()
    this._unsubEdits = this.api().subscribeBuildRoomEdits(code, (edits) => {
      for (const edit of edits) {
        if (this._seen.has(edit.id)) continue
        this._seen.add(edit.id)
        if (edit.uid === uid) continue
        this._applyOps(edit.ops)
      }
    })
    this._unsubPlayers = this.api().subscribeBuildRoomPlayers(code, (players) => this._onPlayers(players))
    this._lastSent = null
    this._presenceTimer = setInterval(() => this._sendPresence(), PRESENCE_MS)
    this._sendPresence(true)
    this._toast(t(this.isHost ? 'togetherHostToast' : 'togetherJoinToast', { code }))
    this._renderPanel()
  }

  async leave() {
    if (!this.active) return
    this._flush()
    this.active = false
    clearInterval(this._presenceTimer)
    clearTimeout(this._sendTimer)
    this._unsubEdits?.()
    this._unsubPlayers?.()
    const uid = this._uid()
    const code = this.code
    this.code = null
    for (const uidKey of [...this._others.keys()]) this._removeOther(uidKey)
    this._renderPanel()
    if (uid && code) await this.api().removeBuildRoomPlayer(code, uid).catch(() => {})
  }

  // --- sending ---

  // Called by BuildMode for every change made here (not ones arriving
  // from the room). op: ['p', x, y, z, type, state] place, ['r', x, y, z]
  // remove, ['d', x, y, z, open] door, ['l', x, y, z, on] lever,
  // ['s', x, y, z, text] sign words.
  record(op) {
    if (!this.active || this.applyingRemote) return
    this._pending.push(op)
    if (this._pending.length >= OPS_PER_EDIT) this._flush()
    else if (!this._sendTimer) this._sendTimer = setTimeout(() => this._flush(), SEND_DELAY_MS)
  }

  // An undo-history entry (a placement/removal, or undo/redo replaying
  // one): forward = as it happened, false = taken back.
  recordEntry(entry, forward) {
    if (!this.active || this.applyingRemote || !entry) return
    if (entry.action === 'group') {
      const list = forward ? entry.entries : [...entry.entries].reverse()
      for (const e of list) this.recordEntry(e, forward)
      return
    }
    if ((entry.action === 'place') === forward) this.record(['p', entry.x, entry.y, entry.z, entry.type, entry.state || null])
    else this.record(['r', entry.x, entry.y, entry.z])
  }

  _flush() {
    clearTimeout(this._sendTimer)
    this._sendTimer = null
    if (!this.active || !this._pending.length) return
    const uid = this._uid()
    while (this._pending.length) {
      const ops = this._pending.splice(0, OPS_PER_EDIT)
      this.api().sendBuildRoomEdit(this.code, uid, this._name(), JSON.stringify(ops)).catch(() => {})
    }
  }

  // --- receiving (untrusted: anyone in the room wrote it) ---

  _applyOps(raw) {
    let ops
    try {
      ops = JSON.parse(raw)
    } catch {
      return
    }
    if (!Array.isArray(ops)) return
    const bm = this.bm
    const ok = (n) => Number.isInteger(n) && Math.abs(n) <= MAX_COORD
    this.applyingRemote = true
    const wasSuppressed = bm._suppressUndoRecording
    bm._suppressUndoRecording = true
    try {
      for (const op of ops.slice(0, OPS_PER_EDIT)) {
        if (!Array.isArray(op)) continue
        const [kind, x, y, z, a, b] = op
        if (!ok(x) || !ok(y) || !ok(z)) continue
        if (kind === 'p' && typeof a === 'string' && bm.constructor.isBlockType(a)) {
          const here = bm.getBlockAt(x, y, z)
          if (here === a) continue
          if (here) bm.removeBlock(x, y, z)
          bm.placeBlock(x, y, z, a, false, b && typeof b === 'object' ? b : null)
        } else if (kind === 'r') {
          bm.removeBlock(x, y, z)
        } else if (kind === 'd') {
          if (bm.isDoorOpenAt(x, y, z) !== !!a) bm.toggleDoor(x, y, z)
        } else if (kind === 'l') {
          bm.gadgets.setLever(x, y, z, !!a)
        } else if (kind === 's' && typeof a === 'string') {
          bm.gadgets.setSignText(x, y, z, a)
        }
      }
    } finally {
      bm._suppressUndoRecording = wasSuppressed
      this.applyingRemote = false
    }
  }

  // --- where everyone is ---

  _sendPresence(force = false) {
    if (!this.active) return
    const uid = this._uid()
    const cam = this.bm.camera
    const pos = { x: +cam.position.x.toFixed(3), y: +cam.position.y.toFixed(3), z: +cam.position.z.toFixed(3), yaw: +(this.bm._yaw || 0).toFixed(3) }
    const last = this._lastSent
    const moved = !last || Math.hypot(pos.x - last.x, pos.y - last.y, pos.z - last.z) > 0.05 || Math.abs(pos.yaw - last.yaw) > 0.05
    if (!force && !moved && last && Date.now() - last.at < 5000) return
    this._lastSent = { ...pos, at: Date.now() }
    this.api().setBuildRoomPlayer(this.code, uid, { name: this._name(), ...pos, at: Date.now() }).catch(() => {})
  }

  _onPlayers(players) {
    const uid = this._uid()
    const now = Date.now()
    const live = new Set()
    for (const p of players) {
      if (!p || p.uid === uid || now - (Number(p.at) || 0) > PRESENCE_TIMEOUT_MS) continue
      if (![p.x, p.y, p.z, p.yaw].every(Number.isFinite)) continue
      live.add(p.uid)
      let other = this._others.get(p.uid)
      const isNew = !other
      if (!other) other = this._addOther(p.uid, String(p.name || 'Player').slice(0, 24))
      other.target.set(p.x, p.y, p.z)
      if (isNew) other.group.position.set(p.x, p.y - 1.62 * this.B, p.z)
      other.yaw = p.yaw
      other.at = p.at
    }
    for (const key of [...this._others.keys()]) if (!live.has(key)) this._removeOther(key)
    this._renderPanel()
  }

  _addOther(uid, name) {
    const B = this.B
    const group = new THREE.Group()
    // Name tag above the head.
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 64
    const ctx = c.getContext('2d')
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, 8, 256, 48)
    ctx.fillStyle = '#ffe9a8'
    ctx.font = 'bold 30px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name, 128, 32)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
    label.scale.set(1.6 * B, 0.4 * B, 1)
    label.position.y = 2.15 * B
    label.renderOrder = 5
    group.add(label)
    const other = { group, label, name, target: new THREE.Vector3(), yaw: 0, at: 0, body: null }
    loadSkinTexture(DEFAULT_SKIN_DATA_URL).then((skin) => {
      if (!this._others.has(uid)) return
      const body = buildTexturedCharacter(skin)
      const s = (1.8 * B) / 32
      body.scale.setScalar(s)
      body.position.y = 2 * s
      group.add(body)
      other.body = body
    }).catch(() => {})
    this.bm.scene.add(group)
    this._others.set(uid, other)
    return other
  }

  _removeOther(uid) {
    const other = this._others.get(uid)
    if (!other) return
    this.bm.scene.remove(other.group)
    other.group.traverse((o) => {
      if (o.isMesh || o.isSprite) {
        o.geometry?.dispose?.()
        for (const m of [].concat(o.material)) {
          m.map?.dispose?.()
          m.dispose()
        }
      }
    })
    this._others.delete(uid)
  }

  // Each frame: slide the other builders toward where they last were.
  update(dt) {
    if (!this.active) return
    const B = this.B
    for (const o of this._others.values()) {
      // Their spot is their eyes (camera); the figure stands below them.
      const feet = this._tmp || (this._tmp = new THREE.Vector3())
      feet.set(o.target.x, o.target.y - 1.62 * B, o.target.z)
      o.group.position.lerp(feet, Math.min(1, dt * 8))
      o.group.rotation.y = o.yaw + Math.PI
    }
  }
}
