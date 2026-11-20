// GayZ TV reports (2026-11-20, Gaymi's picks): a reported clip shows in the
// owner's Reports list with what helpers marked (real / fake). The owner then:
// - Fake: every report on it is wiped, the clip shows again, and each
//   reporter gets a warning about fake reports.
// - Hide (take down): hidden for everyone, Unhide puts it back (and clears
//   its reports, so 10+ reports don't hide it again).
// - Delete for good: the clip, its GIF and its reports - can't be undone.
// - TV-ban the maker (1 / 7 / 30 days, Forever or Custom), or a full ban
//   (the same IP ban as a player card's) on top. Unban lifts a TV-ban.
// `fs` is firestoreRest.js (or a fake in tests); Firestore's rules don't
// apply to it. Same style as admin.js.
import { ServerError } from './servers.js'
import { cleanText, ipBan, warnPlayer, IP_BAN_MAX_MINUTES } from './admin.js'

export const TV_FAKE_WARNING = 'Please only report GayZ TV clips that really break the rules. Fake reports can get you banned from GayZ TV.'
const validId = (v) => typeof v === 'string' && /^[A-Za-z0-9]{1,40}$/.test(v)
const validUid = (v) => typeof v === 'string' && /^[A-Za-z0-9]{1,128}$/.test(v)
const needFs = (fs) => { if (!fs) throw new ServerError(503, 'no-firestore') }

function banMinutes(minutes) {
  const mins = Math.floor(Number(minutes))
  if (!Number.isFinite(mins) || mins < 0 || mins > IP_BAN_MAX_MINUTES) throw new ServerError(400, 'bad-minutes')
  return mins
}

export async function tvHide(db, fs, { id, hide } = {}) {
  needFs(fs)
  if (!validId(id)) throw new ServerError(400, 'bad-request')
  if (hide === false) {
    await fs.tvClearReports(id, (await fs.tvReporters(id)).filter(validUid))
    await db.update({ [`reportChecks/tv_${id}`]: null })
  } else {
    await fs.tvSetHidden(id, true)
  }
  return { ok: true }
}

export async function tvFake(db, fs, { id } = {}, now = Date.now()) {
  needFs(fs)
  if (!validId(id)) throw new ServerError(400, 'bad-request')
  const uids = (await fs.tvReporters(id)).filter(validUid)
  await fs.tvClearReports(id, uids)
  await db.update({ [`reportChecks/tv_${id}`]: null })
  // Warn whoever reported it (a reporter with no Player ID yet is skipped).
  let warned = 0
  for (const uid of uids) {
    const { pid, nickname } = await fs.accountByUid(uid)
    if (!pid) continue
    try {
      await warnPlayer(db, { pid, text: TV_FAKE_WARNING, nick: nickname }, now)
      warned++
    } catch { /* bad Player ID - skip */ }
  }
  return { ok: true, reports: uids.length, warned }
}

export async function tvDelete(db, fs, { id } = {}) {
  needFs(fs)
  if (!validId(id)) throw new ServerError(400, 'bad-request')
  await fs.tvDeleteClip(id, (await fs.tvReporters(id)).filter(validUid))
  await db.update({ [`reportChecks/tv_${id}`]: null })
  return { ok: true }
}

// minutes: 0 = forever. full: also the IP ban (needs their Player ID and
// a connection seen from it - if not, the TV-ban still holds and
// `fullError` says why).
export async function tvBan(db, fs, { uid, minutes, nick, full } = {}, now = Date.now()) {
  needFs(fs)
  if (!validUid(uid)) throw new ServerError(400, 'bad-request')
  const mins = banMinutes(minutes)
  await fs.tvBanSet(uid, mins ? now + mins * 60000 : 0, cleanText(nick, 24), now)
  if (!full) return { ok: true }
  const { pid } = await fs.accountByUid(uid)
  if (!pid) return { ok: true, fullError: 'no-pid' }
  try {
    await ipBan(db, { pid, minutes: mins, reason: 'GayZ TV', nick }, now)
    return { ok: true, full: true, pid }
  } catch (err) {
    return { ok: true, fullError: err?.code || 'failed', pid }
  }
}

export async function tvUnban(db, fs, { uid } = {}) {
  needFs(fs)
  if (!validUid(uid)) throw new ServerError(400, 'bad-request')
  await fs.tvBanClear(uid)
  return { ok: true }
}

// The TV-bans still running, for the owner's list.
export async function tvBanList(fs, now = Date.now()) {
  if (!fs?.tvBans) return { list: [], error: null }
  try {
    const list = (await fs.tvBans())
      .filter((b) => validUid(b.uid) && (!b.until || b.until > now))
      .map((b) => ({ uid: b.uid, until: b.until, at: b.at, nick: cleanText(b.nick, 24) }))
      .sort((a, b) => b.at - a.at)
    return { list, error: null }
  } catch (err) {
    return { list: [], error: String(err?.message || err).slice(0, 200) }
  }
}
