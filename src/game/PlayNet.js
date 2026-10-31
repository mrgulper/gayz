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
// weapon (or block) in their hands, slid smoothly between updates. Who
// joins or leaves shows as a line in the chat, and what they say in chat
// pops up over their head (SpeechBubble.js).
//
// Everyone sees the same world (2026-10-26, Gaymi: "they didn't see the
// same thing I had on my screen, please fix this from the root cause"):
// besides the zombies, the host's sky (BuildSky.skyState) and animals
// (PlayAnimals.snapshot) are mirrored, and every player's placed and
// broken blocks are shared (queueEdit) - before, each screen rolled its
// own weather, grew its own animals and kept its own blocks.
//
// A solo game from the homepage is a hidden server from the start (a
// "lobby", ServerBrowser.openLobby, 2026-10-26: "it still says
// gayz.vercel.app/map-editor until I click the invite link"), so the
// address bar is its invite link right away. It syncs slowly and plays
// exactly like a solo game until someone opens the link - then it becomes
// a normal server game (_promote), the same as Invite Friends.
import * as THREE from 'three'
import { wearCosmetics, cleanWorn, myWorn } from './Cosmetics.js'
import { poseEmote, EMOTES } from './Emotes.js'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { nameTag } from './BuildCamp.js'
import { serverApi, myDetails } from './ServerBrowser.js'
import { t } from './i18n.js'
import { holdWeapon, holdBlock, poseArms } from './HeldWeapon.js'
import { addChatSystemLine, clearChatSystemLines } from './ChatUI.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { _censorText } from './Game.js'
import { worldSeed, isEarthWorld } from './OpenWorld.js'
import { speechBubble, disposeBubble, fadeBubble, bubbleSeconds } from './SpeechBubble.js'

// Seconds between syncs.
export const SYNC_EVERY = 0.16
// No answer from the server for this long: give up and say so (until
// then it keeps trying, and a drop is put right by _rejoin).
const LOST_AFTER_S = 60
// How quickly avatars and mirrored zombies catch up with the latest spot.
const FOLLOW = 12
// A lobby (a solo game nobody has joined yet) only checks in this often.
const LOBBY_EVERY_MS = 4000
// Placed/broken blocks sent per sync (the rest wait for the next one).
const EDITS_PER_SYNC = 40

// Only one connection per page: a second one used to leave the first
// syncing in the background, still sending this player's own spot under
// their old id - everyone (them included) saw a copy of them following
// them around (2026-10-12, "something following me with my own name").
let current = null

export class PlayNet {
  // info: what create/join returned - { serverId, playerId, token, host, name }.
  // lobby: a solo game ready for friends (see the header).
  constructor(game, info, { lobby = false } = {}) {
    if (current && !current.closed) current.leave()
    current = this
    this.game = game
    this.api = serverApi(game)
    this.serverId = info.serverId
    this._showInAddressBar()
    this.playerId = info.playerId
    this.token = info.token
    this.name = info.name || ''
    // The host's world, for a game made joinable with Invite Friends.
    this.world = info.world || null
    this.isHost = info.host === info.playerId
    // The server's mode: 'main' (Zombie Survival) or 'infection'.
    this.mode = info.mode || 'main'
    this.wave = 0
    this.players = new Map()
    this.survival = null
    this._busy = false
    this._lastOk = performance.now()
    this._hits = []
    this._hurt = []
    this._credits = []
    this._catches = []
    this._skinAsked = new Set()
    this._firstSync = true
    this.lobby = lobby
    this._lastLobbySync = 0
    // Blocks placed/broken here not sent yet, and how far into everyone
    // else's I am.
    this._edits = []
    this._editSeq = 0
    this._say = null
    this._sayN = 0
    this._worldSent = ''
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
    // Blocks changed before this game had a server go out too.
    this._queueMyEdits()
  }

  _queueMyEdits() {
    for (const [key, b] of this.survival?._edits || []) {
      const [x, y, z] = key.split(',').map(Number)
      this.queueEdit(x, y, z, b)
    }
  }

  // Someone opened the link: from now on a normal server game.
  _promote() {
    const s = this.survival
    this.lobby = false
    if (!s) return
    if (s.lobby === this) s.lobby = null
    s.net = this
    s._renderHud?.()
  }

  // While you're on a server the address bar is its invite link
  // (2026-10-25, Gaymi: "make it just as https://gayz.vercel.app/?join=GANPCQ"
  // instead of /map-editor), so copying it or reloading brings you back.
  // A moment later, after the game's own /map-editor address is written.
  get _joinPath() {
    return `/?join=${encodeURIComponent(this.serverId)}`
  }

  _showInAddressBar() {
    setTimeout(() => {
      if (this.closed || location.pathname + location.search === this._joinPath) return
      try { history.replaceState(history.state, '', this._joinPath) } catch { /* leave it */ }
    }, 0)
  }

  _clearAddressBar() {
    if (location.pathname + location.search !== this._joinPath) return
    try { history.replaceState(history.state, '', this.game.buildMode?.active && !this.game.buildMode.survival?.active ? '/map-editor' : '/') } catch { /* leave it */ }
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

  // tier: the zombie's rarity (its coins); assist: they helped, someone
  // else finished it (BuildSurvival._creditAssists).
  queueCredit(to, boss, skeleton = null, tier = 'common', assist = false, shine = null) {
    this._credits.push({ to, boss: !!boss, skeleton, tier, ...(assist ? { assist: true } : {}), ...(shine ? { shine } : {}) })
  }

  // A guest's shot on one of the host's animals (a<id>), or taming it.
  queueAnimalHit(id, dmg, tame = false) {
    this._hits.push({ id, dmg, ...(tame ? { tame: true } : {}) })
  }

  // A guest's Catch Trap on one of the host's zombies (z<id>) or animals
  // (a<id>) - the host rolls it (PlayCatch.hostCatch).
  queueCatch(id) {
    this._hits.push({ id, dmg: 0, catch: true })
  }

  // Host: the answer for that player ({ ok, ...what it was }).
  queueCatchResult(to, result) {
    this._catches.push({ to, ...result })
  }

  // A block I placed (b: its id) or broke (b: '').
  queueEdit(x, y, z, b) {
    this._edits.push({ x, y, z, b: b || '' })
  }

  // Something I said in chat - a bubble over my head for the others.
  say(text) {
    this._say = { n: ++this._sayN, text: String(text).slice(0, 120) }
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
    if (this.lobby) {
      const now = performance.now()
      if (now - this._lastLobbySync < LOBBY_EVERY_MS) return
      this._lastLobbySync = now
    }
    const bm = s.bm
    // Spectating, the others see me where I left off (BuildSurvival.bodyPos).
    const pos = s.bodyPos?.() || bm.tryMode.pos
    // In my hand: the gun, or a block from the inventory (an item or an
    // empty hand shows nothing).
    const holding = s.holding
    const body = {
      ...this.auth,
      state: { x: pos.x, y: pos.y, z: pos.z, yaw: bm._yaw, weapon: holding ? '' : s.weaponId, held: holding?.kind === 'block' ? holding.id : '', firing: !!bm._fireHeld && !holding, dead: !!s.dead, away: document.hidden, emote: s.emotes?.current || '', hat: myWorn(this.game, 'hat'), cape: myWorn(this.game, 'cape') },
      editsAfter: this._editSeq,
    }
    const edits = this._edits.splice(0, EDITS_PER_SYNC)
    if (edits.length) body.edits = edits
    const said = this._say
    if (said) body.say = said
    // Where the host spawned (World Map mode picks it after the game began).
    const world = this.isHost && bm.world?.active && s._spawnPick ? { seed: worldSeed(), earth: isEarthWorld(), pick: s._spawnPick } : null
    const worldKey = world ? JSON.stringify(world) : ''
    if (world && worldKey !== this._worldSent) body.world = world
    if (this.lobby) {
      // Nobody else here yet: just stay alive (and keep the blocks).
    } else if (this.isHost) {
      body.zombies = s.zombieSnapshot()
      body.wave = s.wave
      body.hurt = this._hurt.splice(0)
      body.credits = this._credits.splice(0)
      body.catches = this._catches.splice(0)
      const sky = bm.sky?.skyState?.()
      if (sky) body.sky = sky
      if (s.animals) body.animals = s.animals.snapshot()
      if (s.infection) body.inf = s.infection.snapshot()
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
      if (this._say === said) this._say = null
      if (body.world) {
        this._worldSent = worldKey
        this.world = body.world
      }
      this._apply(res)
    } catch (err) {
      if (this.closed) return
      // Asked-for skins that never arrived get asked for again; unsent
      // blocks go again.
      for (const pid of want) this._skinAsked.delete(pid)
      this._edits.unshift(...edits)
      if (err?.code === 'gone' || err?.code === 'not-in-server') await this._rejoin().catch(() => this._giveUpIfLong())
      else this._giveUpIfLong()
    } finally {
      this._busy = false
    }
  }

  _apply(res) {
    const s = this.survival
    if (!s?.active) return
    if (this.lobby) {
      if (!Object.keys(res.players || {}).length) {
        this._editSeq = res.editSeq || this._editSeq
        this._firstSync = false
        return
      }
      this._promote()
    }
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
      Object.assign(mine, { tx: p.x, ty: p.y, tz: p.z, tyaw: p.yaw, dead: !!p.dead, weapon: p.weapon, held: p.held || '', firing: !!p.firing, emote: EMOTES.includes(p.emote) ? p.emote : '', hat: cleanWorn(p.hat, 'hat'), cape: cleanWorn(p.cape, 'cape') })
      if (p.say && p.say.n !== mine.sayN) {
        mine.sayN = p.say.n
        const left = bubbleSeconds(p.say.text) - (Number(p.say.age) || 0) / 1000
        if (left > 0.3 && !this.game.settings?.mutedChatPlayers?.includes(p.nick)) this._setBubble(mine, _censorText(String(p.say.text || '')), left)
      }
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
    // Everyone's blocks (all of them the first time), then the host's world.
    if (res.edits?.length) s._applyRemoteEdits(res.edits)
    if (res.editSeq !== undefined) this._editSeq = res.editSeq
    if (this.isHost) s._applyRemoteHits(res.hits || [])
    else {
      s._applyZombieSnapshot(res.zombies || {}, this.wave)
      if (res.sky) s.bm.sky?.follow?.(res.sky)
      s.animals?.applySnapshot(res.animals || {})
      if (res.inf) s.infection?.applySnapshot(res.inf)
    }
    for (const amount of res.hurt || []) s._hurtPlayer(amount)
    for (const c of res.credits || []) {
      if (c.assist) s._countAssist(!!c.boss, c.tier, c.shine)
      else s._countKill(!!c.boss, c.skeleton || null, c.tier, c.shine)
    }
    for (const c of res.caught || []) s.catcher?.remoteResult(c)
  }

  _giveUpIfLong() {
    if (!this.closed && performance.now() - this._lastOk > LOST_AFTER_S * 1000) this._lost('serverLost')
  }

  // Dropped from the server - a few seconds of lag (or a hidden tab) and
  // the others' syncs count you as gone, or everyone was and the server was
  // cleared away. Get back into the same one under a new id instead of
  // carrying on alone in a look-alike world (2026-10-26, Gaymi: "it said
  // new server or something and then I can't see my friend").
  async _rejoin() {
    const me = await myDetails(this.game)
    let info
    let reopened = false
    try {
      info = await this.api.join({ ...me, serverId: this.serverId })
    } catch (err) {
      if (err?.code === 'full') return this._lost('serverFullToast')
      if (err?.code !== 'gone') throw err
      // Nobody left in it: open it again under the same id, so the invite
      // link still works and the others get back into it too.
      info = await this.api.create({ ...me, name: this.name, mode: this.mode, world: this.world, id: this.serverId, ...(this.lobby ? { hidden: true } : {}) })
      reopened = true
      if (info.serverId !== this.serverId) {
        // Someone else opened it again first: into theirs.
        this.api.leave(info).catch(() => { /* it'll time out on its own */ })
        info = await this.api.join({ ...me, serverId: this.serverId })
        reopened = false
      }
    }
    if (this.closed) {
      this.api.leave(info).catch(() => { /* it'll time out on its own */ })
      return
    }
    this.playerId = info.playerId
    this.token = info.token
    this._lastOk = performance.now()
    // Everyone's blocks again from the start; a reopened server has none
    // yet, so mine go again too.
    this._editSeq = 0
    if (reopened) this._queueMyEdits()
    if (!this.lobby) addChatSystemLine(this.game, t('serverReconnected'))
  }

  _lost(key) {
    const s = this.survival
    this.close()
    // A lobby is a solo game to the player: it just stops being joinable.
    if (this.lobby) {
      if (s?.lobby === this) s.lobby = null
      return
    }
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
      const sc = (MOB_HEIGHT * B) / 32
      body.scale.setScalar(sc)
      body.position.y = 2 * sc
      player.group.add(body)
      player.body = body
    }).catch(() => { /* no picture: just the name tag */ })
  }

  // A chat bubble over a player's head for `left` seconds.
  _setBubble(player, text, left = bubbleSeconds(text)) {
    if (!text) return
    if (player.bubble) disposeBubble(player.bubble)
    player.bubble = speechBubble(text, this.survival.B)
    player.bubbleLeft = left
    player.group.add(player.bubble)
  }

  _removePlayer(pid) {
    const player = this.players.get(pid)
    if (!player) return
    this.players.delete(pid)
    this.survival?.bm.scene.remove(player.group)
    // The held weapon and block share the game's own geometry - never disposed.
    if (player.gun) player.gun.parent?.remove(player.gun)
    if (player.block) player.block.parent?.remove(player.block)
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
    if (p.bubble && (p.bubbleLeft -= dt) <= 0) {
      disposeBubble(p.bubble)
      p.bubble = null
    } else if (p.bubble) fadeBubble(p.bubble, p.bubbleLeft)
    // Lying down when dead, legs swinging when walking.
    if (p.body) {
      p.body.rotation.x = p.dead ? -Math.PI / 2 : 0
      const speed = dt > 0 ? Math.hypot(p.x - ox, p.z - oz) / dt : 0
      p.walk += dt * speed * 3.2
      const swing = Math.sin(p.walk) * Math.min(1, speed / 2) * 0.7
      const lp = p.body.limbPivots
      if (lp) {
        if (p.gunId !== (p.weapon || '')) {
          const held = holdWeapon(this.game, p.body, p.weapon, p.gun)
          p.gun = held.gun
          p.melee = held.melee
          p.gunId = p.weapon || ''
        }
        if (p.blockId !== (p.held || '')) {
          p.block = holdBlock(this.survival.bm, p.body, p.held, p.block, B)
          p.blockId = p.held || ''
        }
        // Their Hats & Capes and emote (Cosmetics.js, Emotes.js).
        wearCosmetics(p.body, p.hat, p.cape)
        const bob = !p.dead && p.emote ? poseEmote(lp, p.emote, performance.now() / 1000) : null
        p.body.position.y = p.bodyY ?? (p.bodyY = p.body.position.y)
        if (bob !== null) p.body.position.y += bob * p.body.scale.y
        else {
          lp.legR.rotation.x = swing
          lp.legL.rotation.x = -swing
          poseArms(lp, { holding: (!!p.gun || !!p.block) && !p.dead, melee: p.melee, firing: p.firing, swing })
        }
      }
    }
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
    this._clearAddressBar()
    clearInterval(this._interval)
    window.removeEventListener('pagehide', this._onPageHide)
    for (const pid of [...this.players.keys()]) this._removePlayer(pid)
    clearChatSystemLines(this.game)
  }
}
