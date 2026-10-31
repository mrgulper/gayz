// Infection mode (2026-10-31, Gaymi: "one player starts as a zombie and
// tags others to turn them, and the last human wins" - played on servers,
// with bots filling the empty spots). Owned by BuildSurvival
// (survival.infection) when cfg.mode is 'infection' (a NO_ZOMBIE_MODES
// mode: no waves at all).
//
// A round: WAIT_S to get ready, then one player (or bot) at random turns.
// An infected one that touches a human turns them too. Humans can't hurt
// the infected, but a shot stuns one for STUN_S (slow, and it can't tag).
// Every human infected = the infected win; anyone still human when the
// ROUND_S clock runs out wins. The first one is held for HEAD_START_S. END_S later the next round starts.
//
// Whoever runs it (the solo player, or the server's host - see `runs`)
// keeps the round, moves the bots and checks the tags, using everyone's
// spots it already has from the server (PlayNet.players). Its state goes to
// the others in the host's sync (snapshot / applySnapshot, `inf` in
// api/_lib/servers.js). A guest's stun shot travels like a zombie hit
// (PlayNet.queueHit, id 's' + who was hit).
//
// Infected players look like zombies to everyone else and run faster;
// bots are drawn here like the other players (skin + name tag).
import * as THREE from 'three'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { nameTag } from './BuildCamp.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { saveShopProgress } from './Game.js'
import { t } from './i18n.js'

export const TOTAL = 6
export const WAIT_S = 8
export const ROUND_S = 150
export const END_S = 7
export const STUN_S = 2.5
// The first zombie is held this long at the start (everyone begins in one
// spot): the humans' head start.
export const HEAD_START_S = 3
export const HUMAN_WIN_COINS = 25
export const INFECTED_WIN_COINS = 15
const TAG_DIST = 1.2
const INFECTED_SPEED = 1.15
const STUN_SPEED = 0.4
const BOT_HUMAN_SPEED = 5.2
const BOT_INFECTED_SPEED = 5.8
const BOT_SEE = 22
const GRAVITY = 28
const JUMP = 8.6
const FOLLOW = 12
const ZOMBIE_SKIN_URL = '/images/npc/zombie.png'
const BOT_NAMES = ['Bean', 'Pickles', 'Noodle', 'Biscuit', 'Waffles', 'Sprout', 'Gizmo', 'Muffin', 'Tater', 'Pebble']

let _skins = null
function skins() {
  if (!_skins) {
    _skins = Promise.all([
      loadSkinTexture(DEFAULT_SKIN_DATA_URL).catch(() => null),
      loadSkinTexture(ZOMBIE_SKIN_URL).catch(() => null),
    ]).then(([human, zombie]) => ({ human, zombie }))
  }
  return _skins
}

export class Infection {
  constructor(survival) {
    this.s = survival
    this.phase = 'wait'
    this.left = WAIT_S
    this.round = 1
    this.winner = ''
    this.infected = new Set()
    this.stunned = new Map()
    this.bots = new Map()
    this._botN = 0
    this._myId = 'me'
    this._was = { phase: '', meInfected: false, round: 0 }
    this._baseSpeed = survival.bm.tryMode.speedMult ?? 1
    this._skins = null
    skins().then((k) => { this._skins = k })
    this._vignette = document.createElement('div')
    this._vignette.id = 'infection-vignette'
    document.body.appendChild(this._vignette)
  }

  // Whether this game runs the round (solo, a lobby nobody joined yet, or
  // the server's host).
  get runs() {
    const n = this.s.net
    return !n || n.isHost
  }

  // My id: my server player id, or 'me' before there is one. A new id
  // (the lobby was made, or a rejoin) keeps whether I was infected.
  get myId() {
    const id = (this.s.net || this.s.lobby)?.playerId || 'me'
    if (id !== this._myId) {
      if (this.infected.delete(this._myId)) this.infected.add(id)
      this._myId = id
    }
    return id
  }

  get meInfected() {
    return this.infected.has(this.myId)
  }

  // Everyone in the game: { id, x, y, z } in blocks (feet).
  _people() {
    const out = []
    const me = this.s.bodyPos()
    out.push({ id: this.myId, x: me.x, y: me.y, z: me.z })
    for (const [pid, p] of this.s.net?.players || []) if (p.seen) out.push({ id: pid, x: p.tx ?? p.x, y: p.ty ?? p.y, z: p.tz ?? p.z })
    for (const b of this.bots.values()) out.push({ id: b.id, x: b.x, y: b.y, z: b.z, bot: b })
    return out
  }

  humansLeft() {
    return this._people().filter((p) => !this.infected.has(p.id)).length
  }

  update(dt) {
    const s = this.s
    if (!s.active) return
    if (this.runs) this._run(dt)
    else this.left = Math.max(0, this.left - dt)
    for (const [id, left] of this.stunned) {
      if (left - dt <= 0) this.stunned.delete(id)
      else this.stunned.set(id, left - dt)
    }
    for (const b of this.bots.values()) {
      if (this.runs) this._moveBot(b, dt)
      this._drawBot(b, dt)
    }
    this._dressPlayers()
    this._events()
    // Infected: faster (slow while stunned).
    const me = this.myId
    s.bm.tryMode.speedMult = this._baseSpeed * (this.stunned.has(me) ? STUN_SPEED : this.infected.has(me) ? INFECTED_SPEED : 1)
    this._vignette.className = this.infected.has(me) ? (this.stunned.has(me) ? 'on stunned' : 'on') : ''
    if (Math.floor(this.left) !== this._lastShown) {
      this._lastShown = Math.floor(this.left)
      s._renderHud()
    }
  }

  // --- the round (only where it runs) ---

  _run(dt) {
    const people = this._people()
    const real = people.filter((p) => !p.bot).length
    if (this.phase === 'wait') {
      // Bots fill the empty spots (only between rounds).
      this._fillBots(Math.max(0, TOTAL - real))
      this.left -= dt
      if (this.left <= 0) this._begin(this._people())
      return
    }
    if (this.phase === 'end') {
      this.left -= dt
      if (this.left <= 0) {
        this.phase = 'wait'
        this.left = WAIT_S
        this.round++
        this.winner = ''
        this.infected.clear()
        this.stunned.clear()
      }
      return
    }
    // Playing. Whoever left the game isn't counted any more.
    const ids = new Set(people.map((p) => p.id))
    for (const id of this.infected) if (!ids.has(id)) this.infected.delete(id)
    // Patient zero left: someone else turns.
    if (!this.infected.size) {
      const pick = people[Math.floor(Math.random() * people.length)]
      if (pick) this.infected.add(pick.id)
    }
    // Tags: an infected one (not stunned) touching a human.
    for (const z of people) {
      if (!this.infected.has(z.id) || this.stunned.has(z.id)) continue
      for (const h of people) {
        if (this.infected.has(h.id)) continue
        if (Math.hypot(h.x - z.x, h.z - z.z) < TAG_DIST && Math.abs(h.y - z.y) < 1.6) this.infected.add(h.id)
      }
    }
    this.left -= dt
    if (!people.some((p) => !this.infected.has(p.id))) this._end('z')
    else if (this.left <= 0) this._end('h')
  }

  _begin(people) {
    this.phase = 'play'
    this.left = ROUND_S
    this.infected.clear()
    this.stunned.clear()
    const pick = people[Math.floor(Math.random() * people.length)]
    if (pick) {
      this.infected.add(pick.id)
      this.stunned.set(pick.id, HEAD_START_S)
    }
  }

  _end(winner) {
    this.phase = 'end'
    this.left = END_S
    this.winner = winner
  }

  _fillBots(want) {
    while (this.bots.size > want) {
      const last = [...this.bots.keys()].pop()
      this._removeBot(last)
    }
    while (this.bots.size < want) {
      const me = this.s.bodyPos()
      const a = Math.random() * Math.PI * 2
      const r = 6 + Math.random() * 8
      const x = me.x + Math.cos(a) * r
      const z = me.z + Math.sin(a) * r
      const y = this.s._groundUnder(x, me.y + 12, z)
      this._addBot(`b${++this._botN}`, { x, y, z, n: this._botN })
    }
  }

  // --- bots ---

  _addBot(id, { x, y, z, n }) {
    const B = this.s.B
    const name = `${BOT_NAMES[(n - 1) % BOT_NAMES.length]} (${t('infectionBot')})`
    const group = new THREE.Group()
    group.add(nameTag(name, B))
    this.s.bm.scene.add(group)
    const bot = { id, n, x, y, z, tx: x, ty: y, tz: z, vy: 0, yaw: 0, tyaw: 0, walk: 0, heading: Math.random() * Math.PI * 2, turnIn: 0, group, human: null, zombie: null, moved: 0 }
    this.bots.set(id, bot)
    return bot
  }

  _removeBot(id) {
    const b = this.bots.get(id)
    if (!b) return
    this.bots.delete(id)
    this.infected.delete(id)
    this.s.bm.scene.remove(b.group)
    disposeTree(b.group)
  }

  _body(skin) {
    const B = this.s.B
    const body = buildTexturedCharacter(skin)
    const sc = (MOB_HEIGHT * B) / 32
    body.scale.setScalar(sc)
    body.position.y = 2 * sc
    return body
  }

  // Runs or hunts: away from the nearest infected (a human bot), after
  // the nearest human (an infected one), or a wander when nobody's close.
  _moveBot(b, dt) {
    const s = this.s
    const infected = this.infected.has(b.id)
    let dx = 0
    let dz = 0
    if (this.phase === 'play') {
      let best = null
      let bestD = BOT_SEE
      for (const p of this._people()) {
        if (p.id === b.id || this.infected.has(p.id) === infected) continue
        const d = Math.hypot(p.x - b.x, p.z - b.z)
        if (d < bestD) {
          bestD = d
          best = p
        }
      }
      if (best) {
        dx = (best.x - b.x) / (bestD || 1)
        dz = (best.z - b.z) / (bestD || 1)
        if (!infected) {
          dx = -dx
          dz = -dz
        }
      }
    }
    if (!dx && !dz) {
      b.turnIn -= dt
      if (b.turnIn <= 0) {
        b.heading = Math.random() * Math.PI * 2
        b.turnIn = 2 + Math.random() * 3
      }
      // Waiting for the round: a slow stroll.
      dx = Math.cos(b.heading) * 0.5
      dz = Math.sin(b.heading) * 0.5
    }
    const speed = (infected ? BOT_INFECTED_SPEED : BOT_HUMAN_SPEED) * (this.stunned.has(b.id) ? STUN_SPEED : 1)
    const ground = s._groundUnder(b.x, b.y + 0.05, b.z)
    const onGround = b.y <= ground + 0.01
    let blocked = false
    for (const [ax, az] of [[dx, 0], [0, dz]]) {
      if (!ax && !az) continue
      const nx = b.x + ax * speed * dt
      const nz = b.z + az * speed * dt
      const cx = Math.floor(nx + Math.sign(ax) * 0.3)
      const cz = Math.floor(nz + Math.sign(az) * 0.3)
      const fy = Math.floor(b.y + 0.05)
      if (s._solid(cx, fy, cz) || s._solid(cx, fy + 1, cz)) {
        blocked = true
        // One block up and room above: jump it.
        if (onGround && !s._solid(cx, fy + 1, cz) && !s._solid(cx, fy + 2, cz)) b.vy = JUMP
        continue
      }
      b.x = nx
      b.z = nz
    }
    if (blocked && !onGround && b.vy <= 0) b.turnIn = 0
    b.vy -= GRAVITY * dt
    b.y += b.vy * dt
    const under = s._groundUnder(b.x, Math.max(b.y, ground) + 0.05, b.z)
    if (b.y <= under) {
      b.y = under
      b.vy = 0
    }
    if (dx || dz) b.tyaw = Math.atan2(dx, dz)
    b.tx = b.x
    b.ty = b.y
    b.tz = b.z
  }

  _drawBot(b, dt) {
    const B = this.s.B
    const k = 1 - Math.exp(-FOLLOW * dt)
    if (!this.runs) {
      b.x += (b.tx - b.x) * k
      b.y += (b.ty - b.y) * k
      b.z += (b.tz - b.z) * k
    }
    let dy = b.tyaw - b.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    b.yaw += dy * k
    const ox = b.group.position.x / B
    const oz = b.group.position.z / B
    b.group.position.set(b.x * B, b.y * B, b.z * B)
    b.group.rotation.y = b.yaw
    if (this._skins && !b.human) {
      if (this._skins.human) b.group.add(b.human = this._body(this._skins.human))
      if (this._skins.zombie) b.group.add(b.zombie = this._body(this._skins.zombie))
    }
    const infected = this.infected.has(b.id)
    if (b.human) b.human.visible = !infected
    if (b.zombie) b.zombie.visible = infected
    const body = infected ? b.zombie : b.human
    const lp = body?.limbPivots
    if (lp) {
      const speed = dt > 0 ? Math.hypot(b.x - ox, b.z - oz) / dt : 0
      b.walk += dt * Math.min(speed, 8) * 3.2
      const swing = Math.sin(b.walk) * Math.min(1, speed / 2) * 0.7
      lp.legR.rotation.x = swing
      lp.legL.rotation.x = -swing
      if (infected) {
        lp.armR.rotation.x = -Math.PI / 2 + swing * 0.2
        lp.armL.rotation.x = -Math.PI / 2 - swing * 0.2
      } else {
        lp.armR.rotation.x = -swing
        lp.armL.rotation.x = swing
      }
    }
  }

  // Other players who are infected wear a zombie body instead of their own.
  _dressPlayers() {
    for (const [pid, p] of this.s.net?.players || []) {
      const infected = this.infected.has(pid)
      if (infected && !p.zbody && this._skins?.zombie && p.body) {
        p.zbody = this._body(this._skins.zombie)
        p.group.add(p.zbody)
      }
      if (p.body) p.body.visible = !infected
      if (p.zbody) {
        p.zbody.visible = infected
        p.zbody.rotation.x = p.dead ? -Math.PI / 2 : 0
        const lp = p.zbody.limbPivots
        if (lp && p.body?.limbPivots) {
          lp.legR.rotation.x = p.body.limbPivots.legR.rotation.x
          lp.legL.rotation.x = p.body.limbPivots.legL.rotation.x
          lp.armR.rotation.x = -Math.PI / 2
          lp.armL.rotation.x = -Math.PI / 2
        }
      }
    }
  }

  // --- what happened, shown on every screen ---

  _events() {
    const s = this.s
    const was = this._was
    const meInf = this.meInfected
    if (this.phase !== was.phase || this.round !== was.round) {
      if (this.phase === 'wait') s._message(t('infectionGetReady'), 4)
      else if (this.phase === 'play') s._message(t(meInf ? 'infectionYouStart' : 'infectionRun'), 4)
      else if (this.phase === 'end') this._roundOver(meInf)
    } else if (this.phase === 'play' && meInf && !was.meInfected) {
      s._message(t('infectionYouTurned'), 4)
    }
    was.phase = this.phase
    was.round = this.round
    was.meInfected = meInf
  }

  _roundOver(meInf) {
    const game = this.s.bm.game
    const won = (this.winner === 'h' && !meInf) || (this.winner === 'z' && meInf)
    const coins = !won ? 0 : meInf ? INFECTED_WIN_COINS : HUMAN_WIN_COINS
    if (coins && game) {
      game.coins = (game.coins || 0) + coins
      saveShopProgress(game)
      game._renderCurrencyBar?.()
    }
    const key = this.winner === 'h' ? (won ? 'infectionHumansWinYou' : 'infectionHumansWin') : (won ? 'infectionZombiesWinYou' : 'infectionZombiesWin')
    this.s._message(t(key, { n: coins }), END_S - 1)
  }

  // The line at the top of the screen.
  hudText() {
    const time = `${Math.floor(this.left / 60)}:${String(Math.floor(this.left % 60)).padStart(2, '0')}`
    const people = this._people()
    const zs = people.filter((p) => this.infected.has(p.id)).length
    if (this.phase === 'wait') return `${t('topBarModeInfection')} · ${t('infectionStartsIn', { n: Math.ceil(this.left) })}`
    return `${t('topBarModeInfection')} · ${t('infectionCounts', { h: people.length - zs, z: zs })} · ${time}${this.meInfected ? ` · ${t('infectionYouAre')}` : ''}`
  }

  // --- shots ---

  // My shot (BuildSurvival.shoot): the nearest infected one on the ray is
  // stunned. Infected can't shoot. Returns true when it hit one.
  shoot(ray, reach) {
    if (this.meInfected || this.phase !== 'play') return false
    const B = this.s.B
    const box = new THREE.Box3()
    const hit = new THREE.Vector3()
    let best = null
    let bestD = reach
    for (const p of this._people()) {
      if (p.id === this.myId || !this.infected.has(p.id)) continue
      box.min.set((p.x - 0.4) * B, p.y * B, (p.z - 0.4) * B)
      box.max.set((p.x + 0.4) * B, (p.y + MOB_HEIGHT) * B, (p.z + 0.4) * B)
      if (!ray.intersectBox(box, hit)) continue
      const d = hit.distanceTo(ray.origin)
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    if (!best) return false
    if (this.runs) this.stun(best.id)
    else {
      this.s.net.queueHit(`s${best.id}`, 0)
      this.stunned.set(best.id, STUN_S)
    }
    return true
  }

  stun(id) {
    if (this.infected.has(id)) this.stunned.set(id, STUN_S)
  }

  // A guest's stun shot (BuildSurvival._applyRemoteHits).
  remoteHit(h) {
    this.stun(String(h.id).slice(1))
  }

  // --- the server ---

  snapshot() {
    const bots = {}
    for (const b of this.bots.values()) bots[b.id] = { x: +b.x.toFixed(2), y: +b.y.toFixed(2), z: +b.z.toFixed(2), h: +b.tyaw.toFixed(2), n: b.n }
    const st = {}
    for (const [id, left] of this.stunned) st[id] = +left.toFixed(1)
    return { ph: this.phase, t: +this.left.toFixed(1), r: this.round, w: this.winner, ids: [...this.infected].map((id) => (id === 'me' ? this.myId : id)), st, bots }
  }

  applySnapshot(d) {
    if (!d || typeof d !== 'object') return
    this.phase = ['wait', 'play', 'end'].includes(d.ph) ? d.ph : 'wait'
    this.left = Number(d.t) || 0
    this.round = Number(d.r) || 1
    this.winner = d.w === 'h' || d.w === 'z' ? d.w : ''
    this.infected = new Set(Array.isArray(d.ids) ? d.ids.map(String) : [])
    this.stunned = new Map(Object.entries(d.st || {}).map(([id, left]) => [id, Number(left) || 0]))
    const seen = new Set()
    for (const [id, v] of Object.entries(d.bots || {})) {
      if (!/^b\d{1,4}$/.test(id) || !v) continue
      seen.add(id)
      const b = this.bots.get(id) || this._addBot(id, { x: v.x, y: v.y, z: v.z, n: Number(v.n) || 1 })
      b.tx = v.x
      b.ty = v.y
      b.tz = v.z
      b.tyaw = Number(v.h) || 0
      this._botN = Math.max(this._botN, Number(id.slice(1)))
    }
    for (const id of [...this.bots.keys()]) if (!seen.has(id)) this._removeBot(id)
  }

  dispose() {
    for (const id of [...this.bots.keys()]) this._removeBot(id)
    for (const p of this.s.net?.players?.values?.() || []) {
      if (p.zbody) {
        p.group.remove(p.zbody)
        disposeTree(p.zbody)
        p.zbody = null
      }
      if (p.body) p.body.visible = true
    }
    this.s.bm.tryMode.speedMult = this._baseSpeed
    this._vignette.remove()
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return
    o.geometry?.dispose?.()
    for (const m of [].concat(o.material)) {
      if (o.isSprite) m.map?.dispose?.()
      m.dispose?.()
    }
  })
}
