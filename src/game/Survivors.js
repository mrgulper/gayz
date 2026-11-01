// Survivors to rescue (2026-10-31, Gaymi's idea list: "human NPCs stuck
// on rooftops. Save them and they join your base or give you quests").
// One of the world events (WorldEvents.js picks 'survivor'); run by
// BuildSurvival (alone, or as a server's host - the others don't see them).
//
// - A survivor appears on the highest spot ROOF_NEAR..ROOF_FAR blocks
//   from you (a rooftop in a town), waving, with a "Help!" bubble and a
//   green light beam. They hold out HOLD_OUT seconds, then they're gone.
// - Walk up to them (RESCUE_REACH blocks) to rescue them. They take turns:
//   - joins you: follows you round for the rest of the run and shoots the
//     nearest zombie within SHOOT_RANGE blocks every SHOOT_EVERY seconds
//     (HELPER_DAMAGE of your gun's damage). Zombies leave them alone. At
//     most MAX_HELPERS at a time.
//   - gives you a quest: kill QUEST_BASE + half the wave number zombies in
//     QUEST_TIME seconds for QUEST_COINS coins and a trap.
//
// Upgraded 2026-10-31 (Gaymi picked "they stay at camp AND take orders"):
// - Everyone you rescue moves into your camp for good (CAMP_KEY, at most
//   CAMP_MAX). In later games (your own, on Map 1) they stand guard in the
//   camp and shoot zombies that come near the walls.
// - Orders: look at one (TALK_RANGE) and press Use - "Follow me" (at most
//   MAX_HELPERS follow at once) or "Hold here" (they stay put and keep
//   shooting). A prompt under the crosshair says which.
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { NPC_SKINS, nameTag } from './BuildCamp.js'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { speechBubble, disposeBubble } from './SpeechBubble.js'
import { getKeyFor, keyLabel } from './Keybinds.js'

const ROOF_NEAR = 12
const ROOF_FAR = 32
const HOLD_OUT = 120
const RESCUE_REACH = 2.5
export const MAX_HELPERS = 3
const FOLLOW_GAP = 2.5
const FOLLOW_SPEED = 6
const SHOOT_RANGE = 14
const SHOOT_EVERY = 1
const HELPER_DAMAGE = 0.5
const QUEST_BASE = 6
const QUEST_TIME = 90
const QUEST_COINS = 60
const TALK_RANGE = 3.2
// Who lives in your camp: { list: [{ skin }] } (skin = SKINS index).
export const CAMP_KEY = 'gayz-camp-survivors'
export const CAMP_MAX = 8
// How far from the camp's middle the guards stand.
const GUARD_RING = 3
// The camp's people's skins (not the zombie one).
const SKINS = Object.values(NPC_SKINS)

export class Survivors {
  constructor(survival) {
    this.s = survival
    this.waiting = null // the one on the roof: { x, y, z, group, body, left }
    this.helpers = [] // rescued ones with you: order 'follow' or 'hold'
    this.quest = null // { need, got, left }
    this._rescues = 0
  }

  get B() {
    return this.s.B
  }

  // A survivor on a roof near me (WorldEvents). -> true if one appeared.
  spawn(me) {
    if (this.waiting) return false
    let best = null
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2
      const d = ROOF_NEAR + Math.random() * (ROOF_FAR - ROOF_NEAR)
      const x = Math.floor(me.x + Math.cos(a) * d) + 0.5
      const z = Math.floor(me.z + Math.sin(a) * d) + 0.5
      if (this.s.camp?.inside(x, z, 2)) continue
      const top = this.s._groundUnder(x, me.y + 40, z)
      if (top === me.y + 40) continue
      // Room to stand (nothing in the two blocks above the roof).
      if (this.s.bm.getBlockAt(Math.floor(x), Math.floor(top), Math.floor(z)) || this.s.bm.getBlockAt(Math.floor(x), Math.floor(top) + 1, Math.floor(z))) continue
      if (!best || top > best.y) best = { x, y: top, z }
    }
    if (!best) return false
    const p = this._person(best)
    p.left = HOLD_OUT
    p.bubbleIn = 0
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.3 * this.B, 30 * this.B, 0.3 * this.B), new THREE.MeshBasicMaterial({ color: 0x6aff8a, transparent: true, opacity: 0.3, depthWrite: false }))
    beam.position.y = 15 * this.B
    p.group.add(beam)
    p.beam = beam
    this.waiting = p
    this.s._message(t('buildPlaySurvivorStuck'), 4)
    return true
  }

  // --- your camp's people ---

  static roster() {
    let raw
    try {
      raw = JSON.parse(localStorage.getItem(CAMP_KEY) || 'null')
    } catch {
      raw = null
    }
    const list = Array.isArray(raw?.list) ? raw.list : []
    return list.slice(0, CAMP_MAX).map((p) => ({ skin: Math.max(0, Math.min(SKINS.length - 1, Math.floor(Number(p?.skin)) || 0)) }))
  }

  // One more moves in. -> false if the camp is full.
  _moveIn(p) {
    const list = Survivors.roster()
    if (list.length >= CAMP_MAX) return false
    list.push({ skin: p.skin })
    try {
      localStorage.setItem(CAMP_KEY, JSON.stringify({ list }))
    } catch { /* not kept */ }
    return true
  }

  // A game with a camp (your own, not a server's): the camp's people
  // stand guard round its middle, holding.
  start() {
    const camp = this.s.camp
    if (!camp || this.s.net) return
    const list = Survivors.roster()
    const cx = (camp.zone.cx ?? (camp.zone.x0 + camp.zone.x1) / 2) + 0.5
    const cz = (camp.zone.cz ?? (camp.zone.z0 + camp.zone.z1) / 2) + 0.5
    list.forEach((m, i) => {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2
      const x = cx + Math.cos(a) * GUARD_RING
      const z = cz + Math.sin(a) * GUARD_RING
      // Searched down from just over where you start (in the camp).
      const y = this.s._groundUnder(x, this.s.bm.camera.position.y / this.B + 6, z)
      const p = this._person({ x, y, z }, m.skin)
      p.order = 'hold'
      p.shootIn = SHOOT_EVERY
      this.helpers.push(p)
    })
  }

  get followers() {
    return this.helpers.filter((h) => h.order === 'follow').length
  }

  // The one you're looking at, close enough to talk to.
  _facing() {
    const p = this.s.bm.tryMode.pos
    const yaw = this.s.bm._yaw
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    let best = null
    let bestD = TALK_RANGE
    for (const h of this.helpers) {
      const dx = h.x - p.x
      const dz = h.z - p.z
      const d = Math.hypot(dx, dz)
      if (d > bestD || d < 0.01 || Math.abs(h.y - p.y) > 2.5) continue
      if ((dx * fx + dz * fz) / d < 0.6) continue
      best = h
      bestD = d
    }
    return best
  }

  // Use key: give the one you're looking at an order. True if one was there.
  use() {
    if (this.s.dead) return false
    const h = this._facing()
    if (!h) return false
    if (h.order === 'follow') {
      h.order = 'hold'
      this.s._message(t('survivorHolding'), 2.5)
    } else if (this.followers >= MAX_HELPERS) {
      this.s._message(t('survivorFollowFull', { n: MAX_HELPERS }), 3)
    } else {
      h.order = 'follow'
      this.s._message(t('survivorFollowing'), 2.5)
    }
    this._promptFor = null
    try { audioEngine.playFootstep?.(false, 'default') } catch { /* no audio */ }
    return true
  }

  _updatePrompt() {
    const h = this.s.dead || this.s.camp?.panelOpen ? null : this._facing()
    if (!h && !this._prompt) return
    if (!this._prompt) {
      this._prompt = document.createElement('div')
      this._prompt.id = 'play-survivor-prompt'
      document.body.appendChild(this._prompt)
    }
    this._prompt.style.display = h ? 'block' : 'none'
    const want = h ? h.order : null
    if (want && this._promptFor !== want) {
      this._promptFor = want
      this._prompt.textContent = t(want === 'follow' ? 'survivorPromptHold' : 'survivorPromptFollow', { key: keyLabel(getKeyFor('use')) })
    }
  }

  // Someone standing at `at`: a name tag, and a body when the skin loads.
  _person(at, skin = Math.floor(Math.random() * SKINS.length)) {
    const B = this.B
    const group = new THREE.Group()
    group.position.set(at.x * B, at.y * B, at.z * B)
    group.add(nameTag(t('buildPlaySurvivorName'), B))
    this.s.bm.scene.add(group)
    const p = { x: at.x, y: at.y, z: at.z, group, body: null, t: Math.random() * 6, skin }
    loadSkinTexture(SKINS[skin]).then((skin) => {
      if (!group.parent) return
      const body = buildTexturedCharacter(skin)
      const sc = (MOB_HEIGHT * B) / 32
      body.scale.setScalar(sc)
      body.position.y = 2 * sc
      group.add(body)
      p.body = body
    }).catch(() => {
      // No skin: just the name tag.
    })
    return p
  }

  // Is anyone out there (WorldEvents keeps the event going while they wait)?
  get busy() {
    return !!this.waiting
  }

  update(dt) {
    const me = this.s.dead ? null : this.s.bodyPos()
    const w = this.waiting
    if (w) {
      w.t += dt
      w.left -= dt
      // Waving over their head, turned to face you.
      if (w.body) w.body.limbPivots.armR.rotation.x = Math.PI + Math.sin(w.t * 8) * 0.4
      if (me) w.group.rotation.y = Math.atan2(me.x - w.x, me.z - w.z)
      w.beam.material.opacity = 0.22 + Math.sin(w.t * 3) * 0.08
      if ((w.bubbleIn -= dt) <= 0) {
        w.bubbleIn = 4
        if (w.bubble) disposeBubble(w.bubble)
        w.bubble = speechBubble(t('buildPlaySurvivorHelp'), this.B)
        w.group.add(w.bubble)
      }
      if (w.left <= 0) {
        this._drop(w)
        this.waiting = null
        this.s._message(t('buildPlaySurvivorLost'), 3)
      } else if (me && Math.hypot(me.x - w.x, me.z - w.z) < RESCUE_REACH && Math.abs(me.y - w.y) < 2) this._rescue(w)
    }
    for (const h of this.helpers) this._updateHelper(h, dt, me)
    this._updatePrompt()
    if (this.quest) {
      this.quest.left -= dt
      if (this.quest.left <= 0) {
        this.quest = null
        this.s._message(t('buildPlaySurvivorQuestFailed'), 3)
      }
    }
  }

  // Rescued: they join you, or (every other one) give you a quest.
  _rescue(w) {
    this.waiting = null
    if (w.bubble) disposeBubble(w.bubble)
    w.bubble = null
    w.beam.removeFromParent()
    w.beam.geometry.dispose()
    w.beam.material.dispose()
    this._rescues++
    // Either way they move into your camp for later games (not on a
    // server: the camp's people are yours alone).
    const moved = !this.s.net && this._moveIn(w)
    const home = moved ? ` ${t('survivorMovedIn')}` : ''
    const quest = this._rescues % 2 === 0 || this.followers >= MAX_HELPERS
    if (quest) {
      this._drop(w)
      const need = QUEST_BASE + Math.floor(this.s.wave / 2)
      this.quest = { need, got: 0, left: QUEST_TIME }
      this.s._message(`${t('buildPlaySurvivorQuest', { n: need, s: QUEST_TIME })}${home}`, 5)
    } else {
      w.shootIn = SHOOT_EVERY
      w.order = 'follow'
      this.helpers.push(w)
      this.s._message(`${t('buildPlaySurvivorJoined')}${home}`, 4)
    }
    audioEngine.playLevelUp?.()
  }

  // A kill of mine (BuildSurvival._countKill): the quest counts it.
  onKill() {
    const q = this.quest
    if (!q) return
    q.got++
    if (q.got < q.need) {
      this.s._message(t('buildPlaySurvivorQuestProgress', { n: q.got, m: q.need }), 1.5)
      return
    }
    this.quest = null
    this.s._earn(QUEST_COINS)
    this.s._message(`${t('buildPlaySurvivorQuestDone', { n: QUEST_COINS })} ${this.s._trapSupplies()}`, 4)
    this.s._renderHud()
  }

  // A helper walks to just behind you and shoots the nearest zombie.
  _updateHelper(h, dt, me) {
    const B = this.B
    h.t += dt
    h.moving = false
    if (me && h.order === 'follow') {
      const dx = me.x - h.x
      const dz = me.z - h.z
      const d = Math.hypot(dx, dz)
      // Left far behind (or you fell): they catch up.
      if (d > 25 || Math.abs(me.y - h.y) > 6) {
        h.x = me.x - 1
        h.z = me.z - 1
        h.y = me.y
      } else if (d > FOLLOW_GAP) {
        const step = Math.min(d - FOLLOW_GAP, FOLLOW_SPEED * dt)
        h.x += (dx / d) * step
        h.z += (dz / d) * step
        h.y = this.s._groundUnder(h.x, h.y + 1.5, h.z)
      }
      h.moving = d > FOLLOW_GAP + 0.2
    }
    // The nearest zombie in range: face it and shoot.
    let near = null
    let best = SHOOT_RANGE
    for (const zb of this.s.zombies) {
      if (zb.health <= 0 || zb.hidden) continue
      const d = Math.hypot(zb.x - h.x, zb.y - h.y, zb.z - h.z)
      if (d < best) {
        best = d
        near = zb
      }
    }
    if (near) h.group.rotation.y = Math.atan2(near.x - h.x, near.z - h.z)
    else if (me && Math.hypot(me.x - h.x, me.z - h.z) < 10) h.group.rotation.y = Math.atan2(me.x - h.x, me.z - h.z)
    h.shootIn -= dt
    if (near && h.shootIn <= 0) {
      h.shootIn = SHOOT_EVERY
      const amount = this.s.weapon.damage * HELPER_DAMAGE
      const dir = new THREE.Vector3(near.x - h.x, 0, near.z - h.z).normalize()
      this.s._fx?.spark((h.x + dir.x * 0.6) * B, (h.y + 1.4) * B, (h.z + dir.z * 0.6) * B, { life: 0.12, from: 0.4, to: 0.1, color: 0xffd060 })
      try { audioEngine.playShot('pistol', true) } catch { /* no audio */ }
      this.s.damageZombie(near, amount, dir)
    }
    if (h.body) {
      const lp = h.body.limbPivots
      const swing = h.moving ? Math.sin(h.t * 9) * 0.6 : 0
      if (lp.legR) lp.legR.rotation.x = swing
      if (lp.legL) lp.legL.rotation.x = -swing
      // Gun arm held out at whatever they're shooting.
      lp.armR.rotation.x = near ? -Math.PI / 2 : -swing * 0.5
      lp.armL.rotation.x = swing * 0.5
    }
    h.group.position.set(h.x * B, h.y * B, h.z * B)
  }

  _drop(p) {
    if (p.bubble) disposeBubble(p.bubble)
    p.group.removeFromParent()
    p.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      for (const m of [].concat(o.material)) {
        if (o.isSprite) m.map?.dispose()
        m.dispose()
      }
    })
  }

  clear() {
    if (this.waiting) this._drop(this.waiting)
    for (const h of this.helpers) this._drop(h)
    this.waiting = null
    this.helpers = []
    this.quest = null
    this._rescues = 0
    this._promptFor = null
    if (this._prompt) this._prompt.style.display = 'none'
  }
}
