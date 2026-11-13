// POST /api/live - what every player's page asks for (src/game/LiveConfig.js):
//   { pid }                     -> the banner, event switches, hidden
//                                  maps/builds, and this player's own ban
//   { action: 'report', ... }   -> a player report (chat's Report button)
//   { action: 'seenWarning', pid, id } -> the player pressed OK on a
//                                  warning from the Console
//   { action: 'redeem', pid, code } -> a gift code (Settings)
//   { action: 'stats', who, hits } -> anonymous play counts (PlayStats.js)
// One function for both (Vercel's free plan caps how many there are).
import { handle } from './_lib/handle.js'
import { publicConfig, reportPlayer, seenWarning, redeemCode } from './_lib/admin.js'
import { recordStats } from './_lib/playStats.js'

export default handle((db, body) => {
  if (body.action === 'report') return reportPlayer(db, body)
  if (body.action === 'seenWarning') return seenWarning(db, body)
  if (body.action === 'redeem') return redeemCode(db, body)
  if (body.action === 'stats') return recordStats(db, body)
  return publicConfig(db, body)
})
