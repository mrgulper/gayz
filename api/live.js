// POST /api/live - what every player's page asks for (src/game/LiveConfig.js):
//   { pid }                     -> the banner, event switches, hidden
//                                  maps/builds, and this player's own ban
//   { action: 'report', ... }   -> a player report (chat's Report button)
// One function for both (Vercel's free plan caps how many there are).
import { handle } from './_lib/handle.js'
import { publicConfig, reportPlayer } from './_lib/admin.js'

export default handle((db, body) => (body.action === 'report' ? reportPlayer(db, body) : publicConfig(db, body)))
