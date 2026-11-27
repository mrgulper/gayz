// Player story (2026-11-27): one timeline, newest first, of everything
// already stored about one Player ID. Owner-only (admin action `story`).
// Nothing new is saved - it only reads:
//   adminLog         every team action that names "#PID" (warns, bans,
//                    mutes, gifts, ID changes, notes edited, leaderboard hides)
//   playerReports    reports against them and by them
//   warnings/{pid}   when each warning was seen
//   bans, mutes, ipBans, playerNotes  (only if the history line is gone)
//   idChanges        moved to a new ID / came from an old one
//   pidIps/{pid}     last time the game was opened (newest of 5 addresses)
//   playerGifts/{pid} gifts still waiting to be picked up
//   giftCodesUsed    codes they redeemed
//   feedback, feedbackReplies/{pid}  what they sent and our answers
//   hallOfFame, cheatAlerts, liveConfig.hidden.players
// Firestore (`fs`, optional): their signed-in accounts and their messages
// still in the two Global chat rooms (up to CHAT_PER_ROOM each).
import { ServerError } from './servers.js'
import { validPid, cleanText } from './admin.js'
import { loadRudeChecker } from './autoMod.js'

export const STORY_MAX = 300
export const CHAT_PER_ROOM = 30
const CHAT_ROOMS = { globalChat: 'in-game chat', serverChat: 'homepage chat' }
// A history line this close to a stored item is the same event.
const SAME_MS = 2 * 60 * 1000

// Which group a history line belongs to, by how it starts.
function logKind(text) {
  if (/^(Gift for|Giveaway prize)/.test(text)) return 'gifts'
  if (/^(Hid|Put) /.test(text)) return 'board'
  return 'staff'
}

const num = (v) => Number(v) || 0

export async function playerStory(db, fs, { pid } = {}, now = Date.now()) {
  if (!validPid(pid)) throw new ServerError(400, 'bad-request')
  const [log, reports, warnings, ban, mute, ipBans, note, changes, ips, gifts, codesUsed, feedback, replies, hof, alerts, hidden, isRude] = await Promise.all([
    db.get('adminLog'), db.get('playerReports'), db.get(`warnings/${pid}`), db.get(`bans/${pid}`), db.get(`mutes/${pid}`),
    db.get('ipBans'), db.get(`playerNotes/${pid}`), db.get('idChanges'), db.get(`pidIps/${pid}`), db.get(`playerGifts/${pid}`),
    db.get('giftCodesUsed'), db.get('feedback'), db.get(`feedbackReplies/${pid}`), db.get('hallOfFame'),
    db.get('cheatAlerts'), db.get('liveConfig/hidden/players'), loadRudeChecker(db),
  ])
  const events = []
  const add = (at, kind, text, extra = {}) => {
    if (num(at) > 0 && text) events.push({ at: num(at), kind, text, ...extra })
  }

  // Team actions from the history ("#PID" not followed by more of an ID).
  const tag = new RegExp(`#${pid}(?![A-Za-z0-9])`)
  const logged = []
  for (const l of Object.values(log || {})) {
    const text = cleanText(l?.text, 300)
    if (!text || !tag.test(text)) continue
    logged.push({ at: num(l.at), text })
    add(l.at, logKind(text), text)
  }
  // A stored item only adds its own line when no history line covers it
  // (history keeps the newest few hundred lines).
  const inLog = (at, start) => logged.some((l) => l.text.startsWith(start) && Math.abs(l.at - num(at)) < SAME_MS)

  // Reports.
  for (const r of Object.values(reports || {})) {
    if (r?.target === pid) add(r.at, 'reports', `Reported by ${cleanText(r.byName, 24) || '?'}${cleanText(r.where, 40) ? ` (${cleanText(r.where, 40)})` : ''}`, { quote: cleanText(r.text, 300), who: validPid(r.by) ? r.by : '', rude: isRude(r.text, r.targetName, r.byName) })
    else if (r?.by === pid) add(r.at, 'reports', `Reported ${cleanText(r.targetName, 24) || '?'}${cleanText(r.where, 40) ? ` (${cleanText(r.where, 40)})` : ''}`, { quote: cleanText(r.text, 300), who: validPid(r.target) ? r.target : '', rude: isRude(r.text, r.targetName, r.byName) })
  }

  // Warnings, bans, mutes, notes.
  for (const w of Object.values(warnings || {})) {
    const text = cleanText(w?.text, 300)
    if (!inLog(w?.at, 'Warned')) add(w?.at, 'staff', 'Warned', { quote: text })
    add(w?.seen, 'staff', 'Saw the warning and pressed OK', { quote: text })
  }
  if (ban && !inLog(ban.at, 'K') && !inLog(ban.at, 'B')) add(ban.at, 'staff', `${num(ban.until) ? `Banned until ${new Date(num(ban.until)).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'Banned forever'}`, { quote: cleanText(ban.reason, 120) })
  if (mute && !inLog(mute.at, 'Chat-muted')) add(mute.at, 'staff', 'Chat-muted', { quote: cleanText(mute.reason, 120) })
  for (const b of Object.values(ipBans || {})) {
    if (b?.pid === pid && !inLog(b.at, 'IP-banned')) add(b.at, 'staff', 'IP-banned', { quote: cleanText(b.reason, 120) })
  }
  if (note && !inLog(note.at, 'Edited the notes')) add(note.at, 'staff', 'Private notes edited')

  // ID changes, both ways.
  const out = changes?.[pid]
  if (out && validPid(out.to) && !inLog(out.at, 'Changed Player ID')) add(out.at, 'staff', `Player ID changed to #${out.to}`, { who: out.to })
  for (const [old, c] of Object.entries(changes || {})) {
    if (c?.to === pid && validPid(old)) add(c.at, 'staff', `Came here from old Player ID #${old}`, { who: old })
  }

  // Playing.
  const seen = Object.values(ips || {}).map(num).filter((t) => t > 0)
  const lastSeen = seen.length ? Math.max(...seen) : 0
  if (lastSeen) add(lastSeen, 'play', 'Last opened the game')
  for (const g of Object.values(gifts || {})) {
    add(g?.at, 'gifts', 'Gift waiting (not picked up yet)')
  }
  for (const [code, used] of Object.entries(codesUsed || {})) {
    if (used && used[pid]) add(used[pid], 'gifts', `Redeemed gift code ${cleanText(code, 40)}`)
  }
  for (const f of Object.values(feedback || {})) {
    if (f?.pid === pid) add(f.at, 'play', `Sent feedback (${['idea', 'bug'].includes(f.kind) ? f.kind : 'other'})`, { quote: cleanText(f.text, 300), rude: isRude(f.text, f.nick) })
  }
  for (const r of Object.values(replies || {})) {
    add(r?.at, 'staff', 'Team replied to their feedback', { quote: cleanText(r.text, 300) })
    add(r?.seen, 'play', 'Read the team\'s reply')
  }
  for (const h of Object.values(hof || {})) {
    if (h?.pid === pid) add(h.at, 'board', `Hall of Fame card: ${cleanText(h.title, 60) || cleanText(h.name, 40) || '?'}`)
  }

  // Signed-in accounts (Firestore): leaderboard + chat.
  let accounts = []
  let fsError = null
  let chatError = null
  if (fs?.accountsByPid) {
    try {
      accounts = (await fs.accountsByPid(pid)).filter((a) => a?.uid)
    } catch (err) {
      fsError = String(err?.message || err).slice(0, 200)
    }
  }
  const uids = new Set(accounts.map((a) => a.uid))
  for (const a of accounts) {
    add(a.lastActiveAt, 'board', `Last played signed in as ${cleanText(a.nickname, 24) || '?'} - best wave ${num(a.bestNight)}`)
  }
  for (const c of Object.values(alerts || {})) {
    if (c?.pid === pid || uids.has(c?.uid)) add(c.at, 'board', 'Cheat alarm on their score', { quote: (Array.isArray(c.why) ? c.why : []).map((w) => cleanText(w, 120)).join(' · ') })
  }
  for (const [uid, h] of Object.entries(hidden || {})) {
    if ((uids.has(uid) || h?.pid === pid) && !inLog(h?.at, 'Hid')) add(h?.at, 'board', 'Hidden from the leaderboards', { quote: cleanText(h?.why, 120) })
  }
  if (fs?.chatByUid && uids.size) {
    try {
      const lists = await Promise.all([...uids].slice(0, 3).flatMap((uid) => Object.keys(CHAT_ROOMS).map(async (room) => (await fs.chatByUid(room, uid, CHAT_PER_ROOM)).map((m) => ({ ...m, room })))))
      for (const m of lists.flat()) add(m.at, 'chat', `Said in ${CHAT_ROOMS[m.room]}`, { quote: cleanText(m.text, 300), rude: isRude(m.text, m.nick) })
    } catch (err) {
      chatError = String(err?.message || err).slice(0, 200)
    }
  }

  events.sort((a, b) => b.at - a.at)
  return {
    pid,
    events: events.slice(0, STORY_MAX),
    total: events.length,
    firstAt: events.length ? events[events.length - 1].at : 0,
    lastSeen,
    accounts: accounts.length,
    fsError,
    chatError,
    now,
  }
}
