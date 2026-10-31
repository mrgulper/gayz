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
import * as THREE from 'three'
import { audioEngine } from './Audio.js'
import { t } from './i18n.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { NPC_SKINS, nameTag } from './BuildCamp.js'
import { buildTexturedCharacter, loadSkinTexture } from './MenuAvatar3D.js'
import { speechBubble, disposeBubble } from './SpeechBubble.js'

const ROOF_NEAR = 12
const ROOF_FAR = 32
const HOLD_OUT = 120
const RESCUE_REACH = 2.5
const MAX_HELPERS = 3
const FOLLOW_GAP = 2.5
const FOLLOW_SPEED = 6
const SHOOT_RANGE = 14
const SHOOT_EVERY = 1
const HELPER_DAMAGE = 0.5
const QUEST_BASE = 6
const QUEST_TIME = 90
const QUEST_COINS = 60
// The camp's people's skins (not the zombie one).
const SKINS = Object.values(NPC_SKINS)

export class Survivors {
  constructor(survival) {
    this.s = survival
    this.waiting = null // the one on the roof: { x, y, z, group, body, left }
    this.helpers = [] // the ones following you
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

  // Someone standing at `at`: a name tag, and a body when the skin loads.
  _person(at) {
    const B = this.B
    const group = new THREE.Group()
    group.position.set(at.x * B, at.y * B, at.z * B)
    group.add(nameTag(t('buildPlaySurvivorName'), B))
    this.s.bm.scene.add(group)
    const p = { x: at.x, y: at.y, z: at.z, group, body: null, t: Math.random() * 6 }
    loadSkinTexture(SKINS[Math.floor(Math.random() * SKINS.length)]).then((skin) => {
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
    const quest = this._rescues % 2 === 0 || this.helpers.length >= MAX_HELPERS
    if (quest) {
      this._drop(w)
      const need = QUEST_BASE + Math.floor(this.s.wave / 2)
      this.quest = { need, got: 0, left: QUEST_TIME }
      this.s._message(t('buildPlaySurvivorQuest', { n: need, s: QUEST_TIME }), 5)
    } else {
      w.shootIn = SHOOT_EVERY
      this.helpers.push(w)
      this.s._message(t('buildPlaySurvivorJoined'), 4)
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
    if (me) {
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
    else if (me) h.group.rotation.y = Math.atan2(me.x - h.x, me.z - h.z)
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
  }
}
