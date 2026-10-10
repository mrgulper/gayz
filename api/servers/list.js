// POST /api/servers/list - see api/_lib/servers.js (listServers).
import { handle } from '../_lib/handle.js'
import { listServers } from '../_lib/servers.js'

export default handle((db) => listServers(db))
