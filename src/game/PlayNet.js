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
// (PlayAnimals.snapshot) are mirrored - and since 2026-11-09 the Zombie
// Train, the dragon and the UFO (their snapshot()s), and the go-kart rides
// with your boats in `veh` (others can hop on, RemoteRides.js) - and every player's placed and
// broken blocks are shared (queueEdit) - before, each screen rolled its
// own weather, grew its own animals and kept its own blocks.
//
// A solo game from the homepage is a server from the start (a
// "lobby", ServerBrowser.openLobby, 2026-10-26: "it still says
// gayz.vercel.app/map-editor until I click the invite link"), so the
// address bar is its invite link right away. It syncs slowly and plays
// exactly like a solo game until someone joins (its link, or Global's list
// since 2026-11-16) - then it becomes
// a normal server game (_promote), the same as Invite Friends.
import * as THREE from 'three'
import { wearCosmetics, cleanWorn, myWorn } from './Cosmetics.js'
import { myKillEffect, cleanKillEffect } from './KillEffects.js'
import { TrailMaker, myTrail, cleanTrail } from './WalkTrails.js'
import { myJumpEffect, myDeathEffect, cleanJumpEffect, cleanDeathEffect, playJumpEffect, playDeathEffect } from './JumpDeathEffects.js'
import { myNameStyle, myChatBubble, cleanNameStyle, cleanChatBubble } from './NameChatStyles.js'
import { myGunSkin, cleanGunSkin } from './GunSkins.js'
import { poseEmote, poseSit, sitDrop, walkLegs, EMOTES, emoteSound } from './Emotes.js'
import { buildTexturedCharacter, loadSkinTexture, DEFAULT_SKIN_DATA_URL } from './MenuAvatar3D.js'
import { nameTag } from './BuildCamp.js'
import { serverApi, myDetails } from './ServerBrowser.js'
import { t } from './i18n.js'
import { holdWeapon, holdBlock, poseArms } from './HeldWeapon.js'
import { addChatSystemLine, clearChatSystemLines } from './ChatUI.js'
import { MOB_HEIGHT } from './PlayRules.js'
import { _censorText } from './Game.js'
import { bubbleShows, shownChatText, serverAccess } from './SocialSettings.js'
import { worldSeed, isEarthWorld } from './OpenWorld.js'
import { speechBubble, disposeBubble, fadeBubble, bubbleSeconds } from './SpeechBubble.js'
import { drawRemote, disposeRemote, cleanRemote } from './Vehicles.js'
import { cleanPins } from './MapPins.js'
import { explored, unpackKeys } from './ExploredMap.js'
import { ownerTag, ownerCrown, startOwnerMode } from './OwnerDropIn.js'
import { OwnerPanel, applyOwnerDeliveries } from './OwnerPowers.js'
import { setTarget, ahead } from './NetSmooth.js'
import { cleanLobbyRules } from './LobbyRules.js'
import { rulesMessage } from './CustomLobbyUI.js'
import { drawRemoteRing, disposeRemoteRing, cleanRemoteRing } from './RemoteRings.js'
import { myPetHat, myPetPaint, myRidePaint, cleanPetHat, cleanPetPaint, cleanRidePaint } from './PetRideLooks.js'

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
    // The server's mode: 'main' (Zombie Survival), 'infection', 'zone' or
    // a party mode ('hide', 'ctf', 'koth', 'soccer' - PartyModes.js) or
    // 'td' (Tower Defense, TowerDefense.js).
    this.mode = info.mode || 'main'
    // The owner dropping in (OwnerDropIn.js): 'own' (seen with a gold
    // Owner tag) or 'ghost' (invisible), and the pass that let them in.
    this.owner = info.owner === 'own' || info.owner === 'ghost' ? info.owner : null
    this.drop = this.owner ? info.drop || null : null
    // A custom lobby (LobbyRules.js): the host's rules, and the password
    // it was joined with (for getting back in after a drop).
    this.custom = !!info.custom
    this.rules = this.custom ? cleanLobbyRules(info.rules) : null
    this.password = typeof info.password === 'string' ? info.password : ''
    this._pvp = []
    this.wave = 0
    this.players = new Map()
    this.survival = null
    this._busy = false
    this._lastOk = performance.now()
    this._hits = []
    this._hurt = []
    this._credits = []
    this._catches = []
    // Owner powers (OwnerPowers.js): commands waiting to go out, and the
    // last announcement shown.
    this._oc = []
    this._annN = 0
    this.ownerPanel = null
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
    survival.ownerMode = this.owner
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

  // A guest's Shrink Ray zap on one of the host's zombies (ShrinkRay.js).
  queueShrink(id) {
    this._hits.push({ id, dmg: 0, shrink: true })
  }

  // My spin ring hit another player (friendly fire in a custom lobby,
  // SpinRing._touchPlayers).
  queuePvp(to, dmg) {
    if (this.rules?.ff && this._pvp.length < 10) this._pvp.push({ to, dmg })
  }

  // A ghost's boo on one of the host's zombies (Ghosts.js).
  queueBoo(id) {
    this._hits.push({ id, dmg: 0, boo: true })
  }

  // A guest's snowball on one of the host's zombies (Snowballs.js).
  queueFreeze(id, dmg) {
    this._hits.push({ id, dmg, freeze: true })
  }

  // Host: a zombie bit another player / another player's hit finished it.
  queueHurt(to, amount) {
    this._hurt.push({ to, amount })
  }

  // tier: the zombie's rarity (its coins); assist: they helped, someone
  // else finished it (BuildSurvival._creditAssists).
  // at: where it went down, for their ring-item drop (RingLoot.js).
  // Another player's kill effect (KillEffects.js), from their last state.
  killEffectOf(pid) {
    return this.players.get(pid)?.kfx || ''
  }

  queueCredit(to, boss, skeleton = null, tier = 'common', assist = false, shine = null, at = null, hp = null) {
    this._credits.push({ to, boss: !!boss, skeleton, tier, ...(assist ? { assist: true } : {}), ...(shine ? { shine } : {}), ...(at ? { at: at.map((n) => Math.round(n * 10) / 10) } : {}), ...(Number.isFinite(hp) ? { hp: Math.round(hp) } : {}) })
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
      state: { x: pos.x, y: pos.y, z: pos.z, yaw: bm._yaw, weapon: holding || s.ring ? '' : s.weaponId, held: holding?.kind === 'block' ? holding.id : '', firing: !!bm._fireHeld && !holding, dead: !!s.dead, away: document.hidden, emote: s.emotes?.current || '', sit: +(bm.tryMode._seatEye || 0).toFixed(2), hat: myWorn(this.game, 'hat'), cape: myWorn(this.game, 'cape'), back: myWorn(this.game, 'back'), kfx: myKillEffect(this.game), trail: myTrail(this.game), jfx: myJumpEffect(this.game), dfx: myDeathEffect(this.game), jn: s.jumps || 0, nst: myNameStyle(this.game), cbub: myChatBubble(this.game), gskin: myGunSkin(this.game), phat: myPetHat(this.game), ppaint: myPetPaint(this.game), rpaint: myRidePaint(this.game), veh: [...(s.vehicles?.snapshot() || []), ...(s.kart?.snapshot() || [])], pins: s.pins?.snapshot() || [], spray: s.sprays?.snapshot() || null, kills: s.kills || 0, lane: s.escape?.lane || 0, esc: s.escape?.race && s.escape.done ? 1 : 0, gh: s.ghosts?.snapshot() || null, fog: bm.world?.active && isEarthWorld() ? explored.shareState() : null, ring: s.ring?.netState() || null },
      editsAfter: this._editSeq,
    }
    // Who Can Join My Server (Settings > Social): the host's choice.
    if (this.isHost) body.access = serverAccess(this.game.settings)
    const edits = this._edits.splice(0, EDITS_PER_SYNC)
    if (edits.length) body.edits = edits
    const said = this._say
    if (said) body.say = said
    const pvp = this._pvp.splice(0)
    if (pvp.length) body.pvp = pvp
    const oc = this.owner ? this._oc.splice(0, 5) : []
    if (oc.length) body.oc = oc
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
      if (s.party) body.party = s.party.snapshot()
      const zone = s.zone?.snapshot()
      if (zone) body.zone = zone
      const td = s.td?.snapshot()
      if (td) body.td = td
      // The Zombie Train, the dragon and the UFO (null = none now).
      body.train = s.train?.snapshot() || null
      body.dragon = s.dragon?.snapshot() || null
      body.ufo = s.ufo?.snapshot() || null
      const esc = s.escape?.snapshot?.()
      if (esc) body.esc = esc
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
      const sentAt = performance.now()
      const res = await this.api.sync(body)
      if (this.closed) return
      // Ping (Settings > HUD > Show Ping): one sync's round trip, smoothed.
      const rtt = performance.now() - sentAt
      this.ping = Number.isFinite(this.ping) ? this.ping * 0.7 + rtt * 0.3 : rtt
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
      this._oc.unshift(...oc)
      this._pvp.unshift(...pvp)
      // Closed by the owner (OwnerPowers.js): back to the homepage.
      if (err?.code === 'closed') return this._lost('serverClosedToast')
      if (err?.code === 'gone' || err?.code === 'not-in-server') await this._rejoin().catch((e) => (e?.code === 'banned' ? this._lost('serverBannedToast') : this._giveUpIfLong()))
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
    // World Map mode: friends clear one fog together (ExploredMap.js) -
    // where they walk clears mine, and someone new gets everything I'd
    // already seen, a piece at a time (and sends me theirs).
    const sharedFog = !!s.bm.world?.active && isEarthWorld()
    let newcomer = false
    for (const [pid, p] of Object.entries(res.players || {})) {
      seen.add(pid)
      let mine = this.players.get(pid)
      if (!mine) {
        mine = this._addPlayer(pid, p)
        newcomer = true
        // Not for the players already there when I joined.
        if (!this._firstSync) addChatSystemLine(this.game, t('serverPlayerJoined', { name: p.nick || 'Survivor' }))
      }
      setTarget(mine, p.x, p.y, p.z)
      // Their emote's sound when they start one, quieter further off.
      const emote = EMOTES.includes(p.emote) ? p.emote : ''
      if (emote && emote !== mine.emote && !this._firstSync && !p.dead) {
        const me = s.bodyPos?.()
        emoteSound(emote, s._panTo?.(p.x, p.z) || 0, me ? Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) : 0)
      }
      // Their jump + death effects (JumpDeathEffects.js): a jump count that
      // went up, or alive -> dead since the last sync.
      const jn = Math.max(0, Math.floor(Number(p.jn) || 0))
      if (mine.jn !== undefined && !this._firstSync) {
        if (jn > (mine.jn || 0) && !p.dead) playJumpEffect(s, cleanJumpEffect(p.jfx), Number(p.x), Number(p.y), Number(p.z))
        if (p.dead && !mine.dead) playDeathEffect(s, cleanDeathEffect(p.dfx), Number(p.x), Number(p.y), Number(p.z))
      }
      mine.jn = jn
      // A name style picked (or dropped) since: a new name tag.
      const nst = cleanNameStyle(p.nst)
      if (mine.tag && nst !== mine.nst) {
        const fresh = nameTag(mine.tag.userData.text, s.B, nst)
        fresh.position.copy(mine.tag.position)
        fresh.visible = mine.tag.visible
        mine.group.remove(mine.tag)
        mine.tag.material.map?.dispose()
        mine.tag.material.dispose()
        mine.group.add(fresh)
        mine.tag = fresh
      }
      mine.nst = nst
      mine.cbub = cleanChatBubble(p.cbub)
      Object.assign(mine, { tyaw: p.yaw, dead: !!p.dead, weapon: p.weapon, held: p.held || '', firing: !!p.firing, emote: EMOTES.includes(p.emote) ? p.emote : '', sit: Math.max(0, Math.min(4, Number(p.sit) || 0)), hat: cleanWorn(p.hat, 'hat'), cape: cleanWorn(p.cape, 'cape'), back: cleanWorn(p.back, 'back'), kfx: cleanKillEffect(p.kfx), trail: cleanTrail(p.trail), gskin: cleanGunSkin(p.gskin), phat: cleanPetHat(p.phat), ppaint: cleanPetPaint(p.ppaint), rpaint: cleanRidePaint(p.rpaint), veh: cleanRemote(p.veh), pins: cleanPins(p.pins), spray: p.spray || null, lane: Math.max(0, Math.min(15, Math.floor(Number(p.lane) || 0))), esc: !!p.esc, gh: cleanGhost(p.gh), kills: Number.isFinite(Number(p.kills)) ? Math.max(0, Math.floor(Number(p.kills))) : undefined, ring: cleanRemoteRing(p.ring) })
      if (sharedFog) {
        if (p.fog && typeof p.fog.c === 'string' && p.fog.n !== mine.fogN) {
          mine.fogN = p.fog.n
          explored.addKeys(unpackKeys(p.fog.c))
        }
        if (!p.dead) explored.visitOther(pid, Number(p.x), Number(p.y), Number(p.z))
      }
      if (p.say && p.say.n !== mine.sayN) {
        mine.sayN = p.say.n
        const left = bubbleSeconds(p.say.text) - (Number(p.say.age) || 0) / 1000
        if (left > 0.3 && !this.game.settings?.mutedChatPlayers?.includes(p.nick) && bubbleShows(this.game.settings, p.nick)) this._setBubble(mine, shownChatText(this.game.settings, _censorText(String(p.say.text || ''))), left)
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
      explored.forgetOther(pid)
    }
    // A custom lobby says its rules once, in the chat.
    if (this._firstSync && this.rules) addChatSystemLine(this.game, rulesMessage(this.rules))
    this._firstSync = false
    // The owner dropping in: powers on once the game is running.
    if (this.owner && !this._ownerStarted) {
      this._ownerStarted = true
      startOwnerMode(this.game, s, this.owner)
      this.ownerPanel = new OwnerPanel(this.game, s, this)
      s.ownerPanel = this.ownerPanel
    }
    if (sharedFog && newcomer) explored.startShare()
    // Their spray tags (Sprays.js).
    s.sprays?.syncRemote(this.players)
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
      if (res.party) {
        // The host's vote picked another mode (PartyVote.js): follow it.
        if (s.party && res.party.k && res.party.k !== s.party.kind) s.switchPartyMode?.(res.party.k)
        s.party?.applySnapshot(res.party)
      }
      if (res.zone) s.zone?.applySnapshot(res.zone)
      if (res.td) s.td?.applySnapshot(res.td)
      s.train?.applySnapshot(res.train || null)
      s.dragon?.applySnapshot(res.dragon || null)
      s.ufo?.applySnapshot(res.ufo || null)
      if (res.esc) s.escape?.applySnapshot?.(res.esc)
    }
    for (const amount of res.hurt || []) s._hurtPlayer(amount)
    for (const c of res.credits || []) {
      if (c.assist) s._countAssist(!!c.boss, c.tier, c.shine)
      else {
        s._countKill(!!c.boss, c.skeleton || null, c.tier, c.shine, c.hp || 100)
        // My kill on the host's zombie: my ring-item drop, where it fell.
        if (Array.isArray(c.at)) s.ringLoot?.dropFrom({ x: c.at[0], y: c.at[1], z: c.at[2], boss: !!c.boss, tier: c.tier })
      }
    }
    for (const c of res.caught || []) s.catcher?.remoteResult(c)
    applyOwnerDeliveries(this, res)
  }

  // An owner power to send with the next sync (OwnerPowers.js).
  ownerCommand(cmd) {
    if (this.owner && !this.closed && this._oc.length < 20) this._oc.push(cmd)
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
      info = await this.api.join({ ...me, serverId: this.serverId, ...(this.drop ? { drop: this.drop } : {}), ...(this.password ? { password: this.password } : {}) })
    } catch (err) {
      // The owner never opens a server again by themselves.
      if (err?.code === 'closed') return this._lost('serverClosedToast')
      if (this.owner) return this._lost(err?.code === 'gone' ? 'serverGoneToast' : 'serverJoinFailed')
      if (err?.code === 'full') return this._lost('serverFullToast')
      // Kicked or banned from the Console (api/_lib/admin.js).
      if (err?.code === 'banned') return this._lost('serverBannedToast')
      // Online servers switched off, or maintenance (Console).
      if (err?.code === 'switched-off') return this._lost('liveOnlineClosed')
      if (err?.code !== 'gone') throw err
      // Nobody left in it: open it again under the same id, so the invite
      // link still works and the others get back into it too.
      info = await this.api.create({ ...me, name: this.name, mode: this.mode, world: this.world, id: this.serverId, access: serverAccess(this.game.settings), ...(this.custom ? { custom: true, rules: this.rules, password: this.password } : {}) })
      reopened = true
      if (info.serverId !== this.serverId) {
        // Someone else opened it again first: into theirs.
        this.api.leave(info).catch(() => { /* it'll time out on its own */ })
        info = await this.api.join({ ...me, serverId: this.serverId, ...(this.password ? { password: this.password } : {}) })
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
    // The owner (OwnerDropIn.js): a gold tag and a crown only the server
    // can give.
    // Everyone else: their bought name style (NameChatStyles.js).
    const nst = cleanNameStyle(p.nst)
    const tag = p.own ? null : nameTag(p.nick || 'Survivor', B, nst)
    if (p.own) group.add(ownerTag(p.nick || 'Survivor', B), ownerCrown(B))
    else group.add(tag)
    this.survival.bm.scene.add(group)
    const player = { pid, nick: p.nick, group, tag, nst, body: null, x: 0, y: 0, z: 0, yaw: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, walk: 0, seen: false, dead: false }
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
    player.bubble = speechBubble(text, this.survival.B, player.cbub || '')
    player.bubbleLeft = left
    player.group.add(player.bubble)
  }

  _removePlayer(pid) {
    const player = this.players.get(pid)
    if (!player) return
    this.players.delete(pid)
    this.survival?.bm.scene.remove(player.group)
    // Their boats and helicopters (Vehicles.js), and spray tags (Sprays.js).
    disposeRemote(player)
    disposeRemoteRing(this.survival, player)
    this.survival?.sprays?.dropRemote(pid)
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
    // Between syncs they keep going the way they were (NetSmooth.js).
    ahead(p, dt)
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
    // Their boats and helicopters (Vehicles.js), and their spin ring.
    drawRemote(this.survival, p, dt)
    drawRemoteRing(this.survival, p, dt)
    // Their walk trail (WalkTrails.js).
    if (!p.trailer) p.trailer = new TrailMaker()
    p.trailer.step(this.survival, p.dead ? '' : p.trail, p.x, p.y, p.z, dt)
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
        // Their gun, in their gun skin (GunSkins.js).
        if (p.gunId !== (p.weapon || '') || p.gunSkinId !== (p.gskin || '')) {
          const held = holdWeapon(this.game, p.body, p.weapon, p.gun, p.gskin || '')
          p.gun = held.gun
          p.melee = held.melee
          p.gunId = p.weapon || ''
          p.gunSkinId = p.gskin || ''
        }
        if (p.blockId !== (p.held || '')) {
          p.block = holdBlock(this.survival.bm, p.body, p.held, p.block, B)
          p.blockId = p.held || ''
        }
        // Their hat, cape, back item and emote (Cosmetics.js, Emotes.js).
        wearCosmetics(p.body, p.hat, p.cape, p.back)
        const bob = poseEmote(lp, !p.dead && p.emote ? p.emote : '', performance.now() / 1000)
        p.body.position.y = p.bodyY ?? (p.bodyY = p.body.position.y)
        if (bob !== null) {
          p.body.position.y += bob * p.body.scale.y
          if (Math.abs(swing) > 0.01) walkLegs(lp, swing)
        } else if (p.sit && !p.dead) {
          // Sitting in their vehicle (Emotes.poseSit).
          p.body.position.y += sitDrop(p.sit, B)
          poseSit(lp)
          poseArms(lp, { holding: !!p.gun || !!p.block, melee: p.melee, firing: p.firing, swing: 0 })
        } else {
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
    if (this.ownerPanel) {
      this.ownerPanel.dispose()
      if (this.survival?.ownerPanel === this.ownerPanel) this.survival.ownerPanel = null
      this.ownerPanel = null
    }
    if (this.survival) this.survival.adminFrozen = false
    for (const pid of [...this.players.keys()]) this._removePlayer(pid)
    clearChatSystemLines(this.game)
  }
}

// Someone's ghost (Ghosts.js): their grave and the zombies they marked.
function cleanGhost(v) {
  if (!v || typeof v !== 'object' || !Array.isArray(v.g) || v.g.length !== 3 || !v.g.every(Number.isFinite)) return null
  return { g: v.g, m: [].concat(v.m || []).filter(Number.isInteger).slice(0, 4) }
}

