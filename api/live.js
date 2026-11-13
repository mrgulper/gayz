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
// One function for both (Vercel's free plan caps how many there are).
import { handle } from './_lib/handle.js'
import { publicConfig, reportPlayer, seenWarning, redeemCode } from './_lib/admin.js'
import { recordStats } from './_lib/playStats.js'
import { sendFeedback, votePoll, recordError, contentReportAlert } from './_lib/inbox.js'

export default handle((db, body) => {
  if (body.action === 'report') return reportPlayer(db, body)
  if (body.action === 'seenWarning') return seenWarning(db, body)
  if (body.action === 'redeem') return redeemCode(db, body)
  if (body.action === 'stats') return recordStats(db, body)
  if (body.action === 'feedback') return sendFeedback(db, body)
  if (body.action === 'vote') return votePoll(db, body)
  if (body.action === 'error') return recordError(db, body)
  if (body.action === 'contentReport') return contentReportAlert(db, body)
  return publicConfig(db, body)
})
