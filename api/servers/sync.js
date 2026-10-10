// POST /api/servers/sync - see api/_lib/servers.js (syncServer).
import { handle } from '../_lib/handle.js'
import { syncServer } from '../_lib/servers.js'

export default handle((db, body) => syncServer(db, body))
