// Zombie Radios (2026-11-01, Gaymi's idea list: "a radio you find in the
// world that plays silly news reports and drops hints like 'supply crate
// near the old tower'"; Gaymi picked "found in the world"). Now and then
// an old radio sits on the ground NEAR..FAR blocks from you, a music note
// bobbing over it. Walk up to it (HEAR_R) and it crackles into a silly
// broadcast (zombieRadio1..N, shown over it and on screen) - and, alone or
// as a server's host with no other world event going, often a real tip:
// a supply plane is on its way (WorldEvents `supply`). Each radio plays
// once, then goes quiet. At most MAX_RADIOS at a time; ones left far
// behind go, so new ones keep turning up.
//
// Owned by BuildSurvival (`s.radios`), stepped from its update(). Each
// player's own scenery (nothing to sync). Meshes and sprites only, never
// a light; each radio's materials are its own (freed when it goes).
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { speechBubble, disposeBubble, bubbleSeconds, fadeBubble } from './SpeechBubble.js'

export const RADIO_LINES = 10
const MAX_RADIOS = 2
const LOOK_EVERY_S = 5
const PLACE_CHANCE = 0.3
const FIRST_S = 25 // the first one turns up about this soon
const NEAR = 14
const FAR = 30
const DESPAWN = 90
const HEAR_R = 2.6
const TIP_CHANCE = 0.6
const TIP_DELAY_S = 2.5

function notePicture() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  g.font = 'bold 52px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 6
  g.strokeStyle = 'rgba(0, 0, 0, 0.8)'
  g.strokeText('♪', 32, 34)
  g.fillStyle = '#ffe066'
  g.fillText('♪', 32, 34)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class ZombieRadio {
  constructor(survival) {
    this.s = survival
    this.list = []
    this._lookIn = FIRST_S
    this._tipIn = 0
  }

  clear() {
    for (const r of [...this.list]) this._remove(r)
    this._lookIn = FIRST_S
    this._tipIn = 0
  }

  update(dt) {
    const s = this.s
    const me = s.bodyPos()
    const time = performance.now() / 1000
    for (const r of [...this.list]) {
      if (Math.hypot(r.x - me.x, r.z - me.z) > DESPAWN) {
        this._remove(r)
        continue
      }
      if (!r.played) {
        r.note.position.y = (1.1 + Math.sin(time * 3) * 0.12) * s.B
        r.light.material.color.setHex(Math.sin(time * 6) > 0 ? 0xff3a2a : 0x5a1410)
        if (!s.dead && Math.hypot(r.x - me.x, r.z - me.z) < HEAR_R && Math.abs(r.y - me.y) < 2.5) this._play(r)
      } else if (r.bubble) {
        r.bubbleLeft -= dt
        fadeBubble(r.bubble, r.bubbleLeft)
        if (r.bubbleLeft <= 0) {
          disposeBubble(r.bubble)
          r.bubble = null
        }
      }
    }
    if (this._tipIn > 0) {
      this._tipIn -= dt
      if (this._tipIn <= 0) this._tip()
    }
    this._lookIn -= dt
    if (this._lookIn > 0) return
    this._lookIn = LOOK_EVERY_S
    if (this.list.length < MAX_RADIOS && Math.random() < PLACE_CHANCE) this._place(me)
  }

  // Somewhere on dry ground a short walk away (not in a camp). -> the radio or null.
  _place(me) {
    const s = this.s
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2
      const d = NEAR + Math.random() * (FAR - NEAR)
      const x = Math.floor(me.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(me.z + Math.sin(a) * d) + 0.5
      if (s.camp?.inside?.(x, z, 2)) continue
      const y = s._groundUnder(x, me.y + 10, z)
      if (!Number.isFinite(y) || Math.abs(y - me.y) > 8) continue
      if (s.bm._cellIsLiquid(Math.floor(x), Math.floor(y - 0.5), Math.floor(z))) continue
      // Room to stand there.
      if (s.bm._cellSolidTop(Math.floor(x), Math.floor(y + 0.01), Math.floor(z)) > 0) continue
      const r = this._build(x, y, z, Math.atan2(me.x - x, me.z - z))
      this.list.push(r)
      return r
    }
    return null
  }

  _build(x, y, z, facing) {
    const B = this.s.B
    const group = new THREE.Group()
    const mats = []
    const box = (w, h, d, px, py, pz, color, basic = false) => {
      const mat = basic ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color })
      mats.push(mat)
      const m = new THREE.Mesh(new THREE.BoxGeometry(w * B, h * B, d * B), mat)
      m.position.set(px * B, py * B, pz * B)
      group.add(m)
      return m
    }
    // An old boxy radio: body, speaker, dial, handle, antenna, a red light.
    box(0.7, 0.42, 0.26, 0, 0.21, 0, 0x6a4a2e)
    box(0.3, 0.3, 0.02, -0.16, 0.22, 0.135, 0x2b2016)
    box(0.22, 0.1, 0.02, 0.19, 0.28, 0.135, 0xe8d8a8)
    box(0.04, 0.06, 0.03, 0.16, 0.28, 0.15, 0xd8352a)
    box(0.4, 0.04, 0.06, 0, 0.5, 0, 0x2b2016)
    const antenna = box(0.025, 0.6, 0.025, 0.28, 0.6, -0.06, 0xc9ccd2)
    antenna.rotation.z = -0.35
    const light = box(0.06, 0.06, 0.03, 0.19, 0.13, 0.14, 0xff3a2a, true)
    const tex = notePicture()
    const note = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
    note.scale.set(0.45 * B, 0.45 * B, 1)
    note.position.y = 1.1 * B
    group.add(note)
    group.position.set(x * B, y * B, z * B)
    group.rotation.y = facing
    this.s.bm.scene.add(group)
    return { group, x, y, z, mats, note, light, tex, played: false, bubble: null, bubbleLeft: 0 }
  }

  // Walked up to it: its broadcast.
  _play(r) {
    const s = this.s
    r.played = true
    r.note.visible = false
    r.light.material.color.setHex(0x3a1010)
    const n = 1 + Math.floor(Math.random() * RADIO_LINES)
    const text = t(`zombieRadio${n}`)
    s._message(`\u{1F4FB} ${text}`, 5)
    r.bubble = speechBubble(text, s.B)
    r.bubble.center.set(0.75, 0)
    r.bubble.position.y = 0.9 * s.B
    r.group.add(r.bubble)
    r.bubbleLeft = bubbleSeconds(text)
    try {
      audioEngine.playRadioChatter?.()
      audioEngine.playSpecial?.(`radio${1 + Math.floor(Math.random() * 3)}`)
    } catch { /* no audio */ }
    // A real tip, now and then: a supply plane on its way.
    const events = s.events
    const canTip = events && !events._run && !s.cfg?.noZombies && (!s.net || s.net.isHost)
    if (canTip && Math.random() < TIP_CHANCE) this._tipIn = TIP_DELAY_S
  }

  _tip() {
    const events = this.s.events
    if (!events || events._run || !this.s.active) return
    if (events.start('supply')) this.s._message(`\u{1F4FB} ${t('zombieRadioTip')}`, 5)
  }

  _remove(r) {
    r.group.removeFromParent()
    r.group.traverse((o) => { if (o.isMesh) o.geometry.dispose() })
    for (const m of r.mats) m.dispose()
    r.note.material.dispose()
    r.tex.dispose()
    if (r.bubble) disposeBubble(r.bubble)
    this.list = this.list.filter((o) => o !== r)
  }
}
