// Playing Map 1 together on a server (2026-10-10, Gaymi: "do the same
// like Kirka, make Global have servers too"). Owned by BuildSurvival
// (survival.net) for a run joined or started from the Global panel's
// server list (ServerBrowser.js).
//
// A few times a second (SYNC_EVERY) one round trip to /api/servers/sync
// (api/_lib/servers.js) sends where I am and gets everyone else back. One
// player - the host, whoever made the server or took over from them - runs
// the zombies and waves for everyone (BuildSurvival as normal, chasing
// whichever player is nearest); everybody else mirrors the host's zombies
// and sends the hits their shots land. A zombie bite on someone else, and
// a kill someone else's shot finished, travel back to that player through
// the server. Coins, ammo, the camp's shop and your stats stay your own.
//
// The other players are drawn as their own skins with name tags and the
// weapon they picked in their hands, slid smoothly between updates. Who
// joins or leaves shows as a line in the chat.
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { nameTag } from './BuildCamp.js'
import { serverApi } from './ServerBrowser.js'
import { t } from './i18n.js'
import { cloneViewmodel } from './Viewmodels.js'
import { addChatSystemLine, clearChatSystemLines } from './ChatUI.js'

// Seconds between syncs.
export const SYNC_EVERY = 0.16
// Held weapons: character units (the body is 32 tall) per viewmodel
// length unit, so a rifle is a little under a block long in their hands.
const GUN_SCALE = 15
// ...but never shorter than this many viewmodel units.
const HELD_MIN_LEN = 0.55
// Their weapons drawn with the world's own light (the guns' metal
// materials render black without an environment map) - one plain
// material per source material, shared by every player, never disposed.
const HELD_MATERIALS = new WeakMap()
function heldMaterial(m) {
  let out = HELD_MATERIALS.get(m)
  if (!out) {
    out = new THREE.MeshLambertMaterial({ map: m.map || null, color: m.color ? m.color.clone() : 0x777777, transparent: !!m.transparent, opacity: m.opacity ?? 1 })
    if (m.emissive) out.emissive = m.emissive.clone()
    HELD_MATERIALS.set(m, out)
  }
  return out
}
// Turns a viewmodel (muzzle along -z, top +y) to lie along the arm: the
// muzzle down the arm towards the hand (-y), its top facing the arm's
// front (+z), so a raised arm points the gun where the player looks.
const HELD_TURN = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)))

// No answer from the server for this long: give up and say so.
const LOST_AFTER_S = 12
// How quickly avatars and mirrored zombies catch up with the latest spot.
const FOLLOW = 12

export class PlayNet {
  // info: what create/join returned - { serverId, playerId, token, host, name }.
  constructor(game, info) {
    this.game = game
    this.api = serverApi(game)
    this.serverId = info.serverId
    this.playerId = info.playerId
    this.token = info.token
    this.name = info.name || ''
    this.isHost = info.host === info.playerId
    this.wave = 0
    this.players = new Map()
    this.survival = null
    this._busy = false
    this._lastOk = performance.now()
    this._hits = []
    this._hurt = []
    this._credits = []
    this._skinAsked = new Set()
    this._firstSync = true
    this.closed = false
    // Closing the tab mid-game leaves the server too.
    this._onPageHide = () => this.leave()
    window.addEventListener('pagehide', this._onPageHide)
    // Syncs run on a timer, not on drawn frames: a hidden tab draws
    // nothing but its timers still tick (about once a second), so a
    // player who switches tabs isn't dropped, and the server knows to
    // hand the zombies to someone else (state.away) if it's the host.
    this._interval = setInterval(() => {
      if (!this._busy && !this.closed) this._sync()
    }, SYNC_EVERY * 1000)
  }

  attach(survival) {
    this.survival = survival
  }

  get auth() {
    return { serverId: this.serverId, playerId: this.playerId, token: this.token }
  }

  // A guest's shot that hit one of the host's zombies.
  queueHit(id, dmg) {
    this._hits.push({ id, dmg })
  }

  // Host: a zombie bit another player / another player's hit finished it.
  queueHurt(to, amount) {
    this._hurt.push({ to, amount })
  }

  queueCredit(to, boss) {
    this._credits.push({ to, boss: !!boss })
  }

  // Living players other than me, for the host's zombies to chase.
  targets() {
    const out = []
    for (const [pid, p] of this.players) if (!p.dead && p.seen) out.push({ x: p.x, y: p.y, z: p.z, remote: pid })
    return out
  }

  // Each frame: slide the other players' avatars along.
  update(dt) {
    if (this.closed) return
    for (const p of this.players.values()) this._drawPlayer(p, dt)
  }

  async _sync() {
    const s = this.survival
    if (!s) return
    const bm = s.bm
    const pos = bm.tryMode.pos
    const body = {
      ...this.auth,
      state: { x: pos.x, y: pos.y, z: pos.z, yaw: bm._yaw, weapon: s.weaponId, firing: !!bm._fireHeld, dead: !!s.dead, away: document.hidden },
    }
    if (this.isHost) {
      body.zombies = s.zombieSnapshot()
      body.wave = s.wave
      body.hurt = this._hurt.splice(0)
      body.credits = this._credits.splice(0)
    } else {
      body.hits = this._hits.splice(0)
    }
    const want = [...this.players.keys()].filter((pid) => !this._skinAsked.has(pid))
    if (want.length) {
      body.skinsFor = want
      for (const pid of want) this._skinAsked.add(pid)
    }
    this._busy = true
    try {
      const res = await this.api.sync(body)
      if (this.closed) return
      this._lastOk = performance.now()
      this._apply(res)
    } catch (err) {
      if (this.closed) return
      // Asked-for skins that never arrived get asked for again.
      for (const pid of want) this._skinAsked.delete(pid)
      if (err?.code === 'gone' || err?.code === 'not-in-server') this._lost('serverClosed')
      else if (performance.now() - this._lastOk > LOST_AFTER_S * 1000) this._lost('serverLost')
    } finally {
      this._busy = false
    }
  }

  _apply(res) {
    const s = this.survival
    if (!s?.active) return
    if (res.isHost !== this.isHost) {
      this.isHost = !!res.isHost
      s._onHostChange(this.isHost)
    }
    this.wave = res.wave || 0
    // Other players come and go.
    const seen = new Set()
    for (const [pid, p] of Object.entries(res.players || {})) {
      seen.add(pid)
      let mine = this.players.get(pid)
      if (!mine) {
        mine = this._addPlayer(pid, p)
        // Not for the players already there when I joined.
        if (!this._firstSync) addChatSystemLine(this.game, t('serverPlayerJoined', { name: p.nick || 'Survivor' }))
      }
      Object.assign(mine, { tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, dead: !!p.dead, weapon: p.weapon, firing: !!p.firing })
      if (!mine.seen) {
        mine.x = p.x
        mine.y = p.y
        mine.z = p.z
        mine.yaw = p.yaw
        mine.seen = true
      }
    }
    for (const [pid, p] of this.players) {
      if (seen.has(pid)) continue
      addChatSystemLine(this.game, t('serverPlayerLeft', { name: p.nick || 'Survivor' }))
      this._removePlayer(pid)
    }
    this._firstSync = false
    if (seen.size !== this._lastCount) {
      this._lastCount = seen.size
      s._renderHud()
    }
    for (const [pid, url] of Object.entries(res.skins || {})) this._setSkin(pid, url || DEFAULT_SKIN_DATA_URL)
    if (this.isHost) s._applyRemoteHits(res.hits || [])
    else s._applyZombieSnapshot(res.zombies || {}, this.wave)
    for (const amount of res.hurt || []) s._hurtPlayer(amount)
    for (const c of res.credits || []) s._countKill(!!c.boss)
  }

  _lost(key) {
    const s = this.survival
    this.close()
    if (s?.active) s._onServerLost(t(key))
  }

  _addPlayer(pid, p) {
    const B = this.survival.B
    const group = new THREE.Group()
    group.add(nameTag(p.nick || 'Survivor', B))
    this.survival.bm.scene.add(group)
    const player = { pid, nick: p.nick, group, body: null, x: 0, y: 0, z: 0, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, walk: 0, seen: false, dead: false }
    this.players.set(pid, player)
    return player
  }

  _setSkin(pid, url) {
    const player = this.players.get(pid)
    if (!player || player.body) return
    loadSkinTexture(url).catch(() => loadSkinTexture(DEFAULT_SKIN_DATA_URL)).then((skin) => {
      if (this.players.get(pid) !== player || player.body) return
      const B = this.survival.B
      const body = buildTexturedCharacter(skin)
      const sc = (1.8 * B) / 32
      body.scale.setScalar(sc)
      body.position.y = 2 * sc
      player.group.add(body)
      player.body = body
    }).catch(() => { /* no picture: just the name tag */ })
  }

  _removePlayer(pid) {
    const player = this.players.get(pid)
    if (!player) return
    this.players.delete(pid)
    this.survival?.bm.scene.remove(player.group)
    // The held weapon shares the game's own geometry - never disposed.
    if (player.gun) player.gun.parent?.remove(player.gun)
    player.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return
      o.geometry?.dispose?.()
      for (const m of [].concat(o.material)) {
        m.map?.dispose?.()
        m.dispose?.()
      }
    })
  }

  _drawPlayer(p, dt) {
    if (!p.seen) return
    const k = 1 - Math.exp(-FOLLOW * dt)
    const ox = p.x
    const oz = p.z
    p.x += (p.tx - p.x) * k
    p.y += (p.ty - p.y) * k
    p.z += (p.tz - p.z) * k
    // Turn the short way round.
    let dy = p.tyaw - p.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    p.yaw += dy * k
    const B = this.survival.B
    p.group.position.set(p.x * B, p.y * B, p.z * B)
    p.group.rotation.y = p.yaw + Math.PI
    // Lying down when dead, legs swinging when walking.
    if (p.body) {
      p.body.rotation.x = p.dead ? -Math.PI / 2 : 0
      const speed = dt > 0 ? Math.hypot(p.x - ox, p.z - oz) / dt : 0
      p.walk += dt * speed * 3.2
      const swing = Math.sin(p.walk) * Math.min(1, speed / 2) * 0.7
      const lp = p.body.limbPivots
      if (lp) {
        if (p.gunId !== (p.weapon || '')) this._holdWeapon(p)
        lp.legR.rotation.x = swing
        lp.legL.rotation.x = -swing
        if (p.gun && !p.dead) {
          // Holding a gun up in front, like the first-person view: right
          // arm on the grip, left arm reaching in under the barrel. A
          // blade is carried at the side and raised to strike.
          const aim = p.firing ? 1 : 0.92
          lp.armR.rotation.set(p.melee && !p.firing ? -swing * 0.6 : -Math.PI / 2 * aim, 0, 0)
          lp.armL.rotation.set(p.melee ? swing : -Math.PI / 2.4 * aim, 0, p.melee ? 0 : 0.45)
        } else {
          lp.armR.rotation.set(p.firing ? -Math.PI / 2 : -swing, 0, 0)
          lp.armL.rotation.set(p.firing ? -Math.PI / 2.3 : swing, 0, 0)
        }
      }
    }
  }

  // Puts the weapon this player is holding (their weapon picker's pick,
  // sent with every sync) in their right hand - a copy of the game's own
  // model, swapped when they pick another.
  _holdWeapon(p) {
    const armR = p.body?.limbPivots?.armR
    if (!armR) return
    if (p.gun) armR.remove(p.gun)
    p.gun = null
    p.gunId = p.weapon || ''
    const source = this.game.weapons?.viewmodels?.[p.gunId]
    if (!source) return
    const gun = cloneViewmodel(source)
    gun.visible = true
    gun.traverse((o) => {
      if (!o.isMesh) return
      o.material = Array.isArray(o.material) ? o.material.map(heldMaterial) : heldMaterial(o.material)
      o.castShadow = false
    })
    const held = new THREE.Group()
    held.add(gun)
    held.quaternion.copy(HELD_TURN)
    // Small guns get a minimum size, or a pistol hides inside the hand.
    const len = new THREE.Box3().setFromObject(gun).getSize(new THREE.Vector3()).z || 0.5
    held.scale.setScalar(GUN_SCALE * Math.max(1, HELD_MIN_LEN / len))
    // In the hand at the end of the arm (the arm is 12 long).
    held.position.set(0, -11, 0)
    held.userData.heldWeapon = true
    armR.add(held)
    p.gun = held
    p.melee = /melee|knife|tomahawk/i.test(p.gunId)
  }

  // Leaving (Back, closing the tab): tell the server so the others see it
  // straight away instead of after STALE_MS.
  leave() {
    if (this.closed) return
    const auth = this.auth
    this.close()
    this.api.leave(auth).catch(() => { /* it'll time out on its own */ })
  }

  close() {
    this.closed = true
    clearInterval(this._interval)
    window.removeEventListener('pagehide', this._onPageHide)
    for (const pid of [...this.players.keys()]) this._removePlayer(pid)
    clearChatSystemLines(this.game)
  }
}
