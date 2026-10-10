// POST /api/servers/leave - see api/_lib/servers.js (leaveServer).
import { handle } from '../_lib/handle.js'
import { leaveServer } from '../_lib/servers.js'

export default handle((db, body) => leaveServer(db, body))
