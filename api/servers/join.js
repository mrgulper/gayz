// POST /api/servers/join - see api/_lib/servers.js (joinServer).
import { handle } from '../_lib/handle.js'
import { joinServer } from '../_lib/servers.js'

export default handle((db, body) => joinServer(db, body))
