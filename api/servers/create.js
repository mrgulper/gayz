// POST /api/servers/create - see api/_lib/servers.js (createServer).
import { handle } from '../_lib/handle.js'
import { createServer } from '../_lib/servers.js'

export default handle((db, body) => createServer(db, body))
