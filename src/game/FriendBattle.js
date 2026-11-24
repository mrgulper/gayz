// Friend pet battles (pet battles round 3, Batch G, 2026-11-23): challenge
// an online friend and both of you watch the same fight at the same time.
// Plan: docs/notes/team-battle-batches.md.
//
// Gaymi's answers: a Pet Battle button on a friend's profile AND a "Battle a
// Friend" list of online friends on the Pets tab; XP only, no coins (so
// friends can't farm coins off each other); the invite only pops up on the
// homepage and menus (while you play in the world it waits quietly, then
// shows once you're back); its own "vs friends" win/loss record (fw / fl
// in the creatures save).
//
// How it works: the challenger posts an invite (Firestore petDuels/{id},
// CloudSync's Friend pet battle functions + rules) with their team packed
// (packTeam + snacks). The friend has INVITE_S seconds to say yes; yes adds
// their team and a dice seed. Then both screens build the same TeamBattle
// (`live`: the challenger's team is always the arena's 'mine' side, fixed
// steps, seeded dice), so the fight plays out the same on both without
// sending anything more. The friend who accepted sees it turned round,
// their own team at the bottom. The challenger deletes the invite once it's
// started, said no to, or given up on; the friend deletes old ones.
//
// Leaving early: no win, no loss for whoever left; the other screen just
// plays on to the end (it's the same fight either way).
import * as CloudSync from './CloudSync.js'
import { TeamBattle, CHEER_IDS } from './TeamBattle.js'
import { loadCreatures, saveCreatures, packTeam, unpackTeam, power, SNACKS, TEAM_SIZE } from './Creatures.js'
import { saveSettings } from './Game.js'
import { t } from './i18n.js'
import { raidTeam, openRaid, bossOf, bossName } from './PetRaid.js'
import { weekId } from './TeamTournament.js'

// Co-op boss raids (PetRaid.js, Batch O) use the same invites, in their own
// Firestore collection (with boss = the week).
const colOf = (raid) => (raid ? 'petRaids' : 'petDuels')

export const INVITE_S = 60
// At most this many friends are checked for "online" in one tap.
export const FRIEND_LIST_MAX = 30
// Invites older than this (by the sender's clock) are thrown away.
const STALE_MS = 60 * 60 * 1000

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const $ = (id) => document.getElementById(id)
const api = (game) => game.__petDuelBackendForTests || CloudSync
const toast = (game, text) => game._showHomepageToast?.(text)
const hasSnack = (id) => typeof id === 'string' && Object.hasOwn(SNACKS, id)

function nick(game) {
  return (game.settings?.nickname || '').trim().slice(0, 24) || t('teamDefaultNick')
}

function friendOf(game, uid) {
  return (game.settings?.savedFriends || []).find((f) => f.uid && f.uid === uid) || null
}

function friendName(game, uid, fallback = '') {
  return String(friendOf(game, uid)?.name || fallback || '?').slice(0, 24)
}

function myTeam() {
  const data = loadCreatures()
  return data.team.map((id) => data.list.find((c) => c.id === id)).filter(Boolean)
}

// My team as sent: packTeam plus each one's snack (a friend battle has
// both friends' snacks).
export function packLive(team) {
  return packTeam(team).map((p, i) => (hasSnack(team[i].sn) ? { ...p, sn: team[i].sn } : p))
}

// A sent team back into creatures, snacks kept. Both screens build both
// teams this way, so they fight with exactly the same numbers.
export function unpackLive(list) {
  if (!Array.isArray(list)) return []
  return list.slice(0, TEAM_SIZE).map((p) => {
    const c = unpackTeam([p])[0]
    if (c && p && hasSnack(p.sn)) c.sn = p.sn
    return c
  }).filter(Boolean)
}

// Invites only pop up on the homepage and menus - not while playing in the
// world, not mid-battle, not while my own invite is out.
export function canShowInvite(game) {
  return !game.buildMode?.active && !game._enteringBuildMode && !game._teamBattle?.root && !game._petDuel && !game._petTrade
}

// --- the box (an invite to me, or my invite waiting) ---

function box() {
  let el = $('pet-duel-box')
  if (el) return el
  el = document.createElement('div')
  el.id = 'pet-duel-box'
  el.className = 'panel-box pet-duel-box'
  el.setAttribute('role', 'dialog')
  el.innerHTML = `
    <p class="pet-duel-text"></p>
    <p class="pet-duel-time"></p>
    <div class="pet-duel-btns">
      <button type="button" class="mini-action-btn pet-duel-yes"></button>
      <button type="button" class="mini-action-btn pet-duel-no"></button>
    </div>`
  // Typing / keys here never reach the game.
  el.addEventListener('keydown', (e) => e.stopPropagation())
  document.body.appendChild(el)
  return el
}

function showBox({ text, yes, no, onYes, onNo }) {
  const el = box()
  el.querySelector('.pet-duel-text').textContent = text
  el.querySelector('.pet-duel-time').textContent = ''
  const y = el.querySelector('.pet-duel-yes')
  const n = el.querySelector('.pet-duel-no')
  y.hidden = !yes
  y.textContent = yes || ''
  y.onclick = onYes || null
  n.textContent = no
  n.onclick = onNo || null
  el.hidden = false
  return el
}

function setBoxTime(text) {
  const el = $('pet-duel-box')
  if (el) el.querySelector('.pet-duel-time').textContent = text
}

function hideBox() {
  const el = $('pet-duel-box')
  if (el) el.hidden = true
}

// --- the battle itself ---

function startLive(game, duel, me, ids, name, raid = false) {
  const a = unpackLive(duel.a)
  const b = unpackLive(duel.b)
  if (!a.length || !b.length || !Number.isInteger(duel.seed) || (raid && !Number.isInteger(duel.boss))) {
    toast(game, t('petDuelFailed'))
    return
  }
  if (game._teamBattle?.root) game._teamBattle.close()
  // Cheers (Batch H): mine go to petCheers/{duel}_{me}, my friend's are
  // watched; each is step * 4 + which cheer, landing at that step on both.
  const backend = api(game)
  const myUid = game._cloudUid
  // (In a raid both friends are 'mine', so it's whoever I'm not.)
  const friendUid = raid ? (duel.from === myUid ? duel.to : duel.from) : me === 'mine' ? duel.to : duel.from
  const canCheer = !!(duel.id && myUid && friendUid && backend.sendPetCheers)
  const sent = []
  let unwatch = null
  const onCheer = async (kind, at) => {
    if (!canCheer || sent.length >= 20) return false
    sent.push(at * 4 + CHEER_IDS.indexOf(kind))
    try {
      await backend.sendPetCheers(duel.id, myUid, friendUid, [...sent])
      return true
    } catch {
      sent.pop()
      return false
    }
  }
  const onClose = () => {
    unwatch?.()
    if (canCheer && sent.length) backend.deletePetCheers?.(duel.id, myUid).catch(() => {})
  }
  // A raid: both teams (the asker's first) against the week's boss, both
  // friends on the same side - no flip, no friend-battle record.
  const battle = raid ? openRaid(game, [...a, ...b], duel.boss, { live: { seed: duel.seed, me: 'mine', ids }, onCheer, onClose }) : new TeamBattle({
    mine: a,
    theirs: b,
    foe: t('petDuelFoe', { name }),
    ghost: false,
    live: { seed: duel.seed, me, ids },
    onCheer,
    onClose,
    // XP only (TeamBattle gives it), no coins; its own record.
    onEnd: (won) => {
      if (won === null) return 0
      const d = loadCreatures()
      if (won) d.fw++
      else d.fl++
      saveCreatures(d)
      game._renderTeamPanel?.()
      return 0
    },
    againKey: () => false,
    view: game.settings?.battleView === '2d' ? '2d' : '3d',
    onView: (v) => {
      if (!game.settings) return
      game.settings.battleView = v
      saveSettings(game.settings)
      const sel = $('battle-view-select')
      if (sel) sel.value = v
    },
  })
  if (!raid) {
    game._teamBattle = battle
    battle.open()
  }
  if (canCheer && backend.watchPetCheers) {
    unwatch = backend.watchPetCheers(duel.id, friendUid, (list) => {
      if (!Array.isArray(list)) return
      for (const v of list.slice(0, 20)) {
        if (!Number.isInteger(v) || v < 0) continue
        const kind = CHEER_IDS[v % 4]
        if (kind) battle.friendCheer(kind, Math.floor(v / 4))
      }
    })
  }
}

// --- challenging a friend (profile button, Pets tab list) ---

// raid: a co-op boss raid invite instead (PetRaid.js).
export async function challengeFriend(game, uid, raid = false) {
  if (game._petDuel || game._petTrade) return toast(game, t('petDuelBusy'))
  if (!game._cloudUid) return toast(game, t('petDuelSignIn'))
  if (!uid || !friendOf(game, uid)) return
  const team = raid ? raidTeam() : myTeam()
  const col = colOf(raid)
  const week = weekId()
  if (!team.length) return toast(game, t('teamNeedOne'))
  const name = friendName(game, uid)
  const state = { id: null, unwatch: null, timer: null, done: false }
  game._petDuel = state
  const finish = (msg) => {
    if (state.done) return
    state.done = true
    state.unwatch?.()
    clearInterval(state.timer)
    if (state.id) api(game).deletePetDuel(state.id, col).catch(() => {})
    hideBox()
    if (game._petDuel === state) game._petDuel = null
    if (msg) toast(game, msg)
  }
  showBox({ text: t(raid ? 'raidSending' : 'petDuelSending', { name }), no: t('petDuelCancel'), onNo: () => finish(null) })
  let id
  try {
    id = await api(game).createPetDuel(game._cloudUid, nick(game), uid, packLive(team), raid ? week : null)
  } catch {
    finish(t('petDuelFailed'))
    return
  }
  if (state.done) {
    // Cancelled while it was being sent.
    api(game).deletePetDuel(id, col).catch(() => {})
    return
  }
  state.id = id
  const until = Date.now() + INVITE_S * 1000
  const ids = team.map((c) => c.id)
  showBox({ text: t(raid ? 'raidWaiting' : 'petDuelWaiting', { name, boss: bossName(bossOf(week).id) }), no: t('petDuelCancel'), onNo: () => finish(null) })
  const tick = () => {
    const left = Math.ceil((until - Date.now()) / 1000)
    if (left <= 0) finish(t('petDuelNoAnswer', { name }))
    else setBoxTime(t('petDuelSeconds', { n: left }))
  }
  tick()
  state.timer = setInterval(tick, 1000)
  state.unwatch = api(game).watchPetDuel(id, (d) => {
    if (state.done) return
    if (!d) finish(t('petDuelGone', { name }))
    else if (d.state === 'no') finish(t('petDuelSaidNo', { name }))
    else if (d.state === 'go') {
      finish(null)
      startLive(game, d, 'mine', ids, name, raid)
    }
  }, col)
}

// --- invites to me ---

// Started on every sign-in change (CloudSaveUI), like Skin Trades.
export function watchPetDuels(game, uid) {
  game._petDuelInvitesUnsub?.()
  game._petDuelInvitesUnsub = null
  clearInterval(game._petDuelTick)
  game._petInvites = []
  game._petInviteShown = null
  if (!uid) return
  if (!game.__petDuelBackendForTests && !CloudSync.isConfigured?.()) return
  const backend = api(game)
  // Battle invites and raid invites (Batch O), into one list.
  const listen = (raid) => backend.subscribePetDuelInvites(uid, (list) => {
    const now = Date.now()
    const seen = new Map((game._petInvites || []).map((d) => [d.id, d.seen]))
    const fresh = []
    for (const d of list || []) {
      if (!d || typeof d.id !== 'string') continue
      // Very old (the sender's app closed mid-wait): tidy it away.
      if (!(d.at > now - STALE_MS)) {
        backend.deletePetDuel(d.id, colOf(raid)).catch(() => {})
        continue
      }
      // Only friends can challenge me.
      if (!friendOf(game, d.from)) continue
      if (raid && !Number.isInteger(d.boss)) continue
      // Timed by when it got here (two devices' clocks can disagree).
      fresh.push({ ...d, raid, seen: seen.get(d.id) || now })
    }
    game._petInvites = [...(game._petInvites || []).filter((d) => !!d.raid !== raid), ...fresh]
    inviteTick(game)
  }, colOf(raid))
  const offRaids = listen(true)
  const offDuels = listen(false)
  game._petDuelInvitesUnsub = () => {
    offDuels?.()
    offRaids?.()
  }
  game._petDuelTick = setInterval(() => inviteTick(game), 1000)
}

export function inviteTick(game, now = Date.now()) {
  game._petInvites = (game._petInvites || []).filter((d) => now - d.seen < INVITE_S * 1000)
  const shown = game._petInviteShown
  if (shown) {
    const still = game._petInvites.find((d) => d.id === shown.id)
    if (!still) {
      // Taken back, or timed out.
      game._petInviteShown = null
      hideBox()
      return
    }
    setBoxTime(t('petDuelSeconds', { n: Math.max(1, Math.ceil((still.seen + INVITE_S * 1000 - now) / 1000)) }))
    return
  }
  const next = game._petInvites[0]
  if (!next || !canShowInvite(game) || game._tradeInviteShown) return
  game._petInviteShown = next
  const name = friendName(game, next.from, next.fromName)
  const theirs = unpackLive(next.a)
  showBox({
    text: next.raid ? t('raidInvite', { name, boss: bossName(bossOf(next.boss).id) }) : t('petDuelInvite', { name, n: theirs.length, power: power(theirs) }),
    yes: t('petDuelYes'),
    no: t('petDuelNo'),
    onYes: () => answer(game, next, true),
    onNo: () => answer(game, next, false),
  })
  inviteTick(game, now)
}

async function answer(game, d, yes) {
  game._petInviteShown = null
  game._petInvites = (game._petInvites || []).filter((o) => o.id !== d.id)
  hideBox()
  const name = friendName(game, d.from, d.fromName)
  const col = colOf(d.raid)
  const team = yes ? (d.raid ? raidTeam() : myTeam()) : []
  if (yes && !team.length) {
    toast(game, t('teamNeedOne'))
    yes = false
  }
  if (!yes) {
    api(game).answerPetDuel(d.id, false, [], 0, col).catch(() => {})
    return
  }
  const seed = 1 + Math.floor(Math.random() * 0x7ffffffe)
  const b = packLive(team)
  let was = null
  try {
    was = await api(game).answerPetDuel(d.id, true, b, seed, col)
  } catch { /* gone */ }
  if (!was) return toast(game, t('petDuelGone', { name }))
  startLive(game, { ...was, b, seed }, d.raid ? 'mine' : 'foe', team.map((c) => c.id), name, !!d.raid)
}

// --- Pets tab: Battle a Friend ---

export function renderFriendBattle(_game) {
  const data = loadCreatures()
  const btn = $('friend-battle-btn')
  if (btn) btn.textContent = t('petDuelListBtn')
  const rec = $('team-friend-record')
  if (rec) rec.textContent = data.fw || data.fl ? t('petDuelRecord', { w: data.fw, l: data.fl }) : ''
}

// My saved friends, and which of them are online now (also Pet trading's
// list, PetTrade.js).
export async function listOnlineFriends(game, backend) {
  const friends = (game.settings?.savedFriends || []).filter((f) => f.uid).slice(0, FRIEND_LIST_MAX)
  const rows = await Promise.all(friends.map(async (f) => {
    const p = await backend.fetchPresence(f.uid).catch(() => null)
    return game._computeFriendStatus?.(p) && game._computeFriendStatus(p) !== 'offline' ? f : null
  }))
  return { friends, online: rows.filter(Boolean) }
}

// raid: the Boss Raid section's list (Raid buttons) instead.
export async function showOnlineFriends(game, raid = false) {
  const list = $(raid ? 'raid-friend-list' : 'friend-battle-list')
  if (!list) return
  if (!game._cloudUid) {
    list.innerHTML = `<p class="team-snack-hint">${esc(t('petDuelSignIn'))}</p>`
    return
  }
  list.innerHTML = `<p class="team-snack-hint">${esc(t('petDuelLooking'))}</p>`
  const { friends, online } = await listOnlineFriends(game, api(game))
  list.innerHTML = online.length
    ? online.map((f) => `<div class="friend-battle-row"><span>${esc(String(f.name).slice(0, 24))}</span><button type="button" class="mini-action-btn" ${raid ? 'data-raid-uid' : 'data-duel-uid'}="${esc(f.uid)}">${esc(t(raid ? 'raidFriendRowBtn' : 'petDuelBtn'))}</button></div>`).join('')
    : `<p class="team-snack-hint">${esc(t(friends.length ? 'petDuelNoneOnline' : 'petDuelNoFriends'))}</p>`
}

export function bindFriendBattle(game) {
  if (game._friendBattleBound) return
  game._friendBattleBound = true
  // The friend's profile button (FriendMail.js) calls this.
  game._challengePetFriend = (uid) => challengeFriend(game, uid)
  // For the tests (tests/team.spec.js).
  game._friendBattle = { challengeFriend, watchPetDuels, inviteTick, packLive, unpackLive, canShowInvite, INVITE_S, TeamBattle }
  $('friend-battle-btn')?.addEventListener('click', () => showOnlineFriends(game))
  $('friend-battle-list')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-duel-uid]')
    if (b) challengeFriend(game, b.dataset.duelUid)
  })
  // Boss Raid with a friend (PetRaid.js, Batch O).
  $('raid-friend-btn')?.addEventListener('click', () => showOnlineFriends(game, true))
  $('raid-friend-list')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-raid-uid]')
    if (b) challengeFriend(game, b.dataset.raidUid, true)
  })
}
