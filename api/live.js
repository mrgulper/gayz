// POST /api/live - what every player's page asks for (src/game/LiveConfig.js):
//   { pid }                     -> the banner, event switches, hidden
//                                  maps/builds, and this player's own ban
//   { action: 'report', ... }   -> a player report (chat's Report button)
//   { action: 'seenWarning', pid, id } -> the player pressed OK on a
//                                  warning from the Console
//   { action: 'redeem', pid, code } -> a gift code (Settings)
//   { action: 'stats', who, hits } -> anonymous play counts (PlayStats.js)
//   { action: 'feedback' | 'vote' | 'error' | 'contentReport', ... } ->
//                                  the Feedback box, a poll vote, an error
//                                  report, a Gallery report alert
//                                  (PlayerVoice.js, api/_lib/inbox.js)
//   { action: 'seenReply', pid, id } -> the player pressed OK on a
//                                  "Staff replied" popup
//   { action: 'dailySummary' }  -> GitHub's site check, every 10 minutes:
//                                  posts the owner's daily summary once a day
//                                  and runs the cheat alarm (leaderboardAdmin.js)
//                                  every few hours, records an uptime
//                                  heartbeat (uptime.js, `back: true` after
//                                  an outage) and posts the Monday weekly
//                                  report (weekly.js) and picks the winners
//                                  of planned giveaways (planner.js)
//   { action: 'hof' }           -> the Hall of Fame cards (HallOfFame.js)
//   { action: 'claimGift', pid, id } -> picks up a gift the team left for
//                                  this Player ID (ownerPowers.js)
// One function for both (Vercel's free plan caps how many there are).
import { handle } from './_lib/handle.js'
import { publicConfig, reportPlayer, seenWarning, redeemCode, publicHallOfFame, claimGiftFor } from './_lib/admin.js'
import { recordStats } from './_lib/playStats.js'
import { cheatScan } from './_lib/leaderboardAdmin.js'
import { heartbeat } from './_lib/uptime.js'
import { weeklyReport } from './_lib/weekly.js'
import { runPlanner } from './_lib/planner.js'
import * as firestoreRest from './_lib/firestoreRest.js'
import { sendFeedback, votePoll, recordError, contentReportAlert, seenReply, dailySummary } from './_lib/inbox.js'

export default handle((db, body) => {
  if (body.action === 'report') return reportPlayer(db, body)
  if (body.action === 'seenWarning') return seenWarning(db, body)
  if (body.action === 'redeem') return redeemCode(db, body)
  if (body.action === 'stats') return recordStats(db, body)
  if (body.action === 'feedback') return sendFeedback(db, body)
  if (body.action === 'vote') return votePoll(db, body)
  if (body.action === 'error') return recordError(db, body)
  if (body.action === 'contentReport') return contentReportAlert(db, body)
  if (body.action === 'seenReply') return seenReply(db, body)
  if (body.action === 'dailySummary') {
    // The cheat scan reads Firestore; a hiccup there never stops the summary.
    const fs = process.env.FIREBASE_SERVICE_ACCOUNT_KEY ? firestoreRest : null
    // The heartbeat goes first so a slow summary never shows up as a gap.
    return heartbeat(db, body).catch(() => null).then((uptime) =>
      Promise.all([dailySummary(db), cheatScan(db, fs).catch(() => null), weeklyReport(db).catch(() => null), runPlanner(db).catch(() => null)]).then(([summary, , weekly, planner]) => ({ ...summary, uptime, weekly, planner }))
    )
  }
  if (body.action === 'hof') return publicHallOfFame(db)
  if (body.action === 'claimGift') return claimGiftFor(db, body)
  return publicConfig(db, body)
})
