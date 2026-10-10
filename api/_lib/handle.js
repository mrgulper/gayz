// Shared wrapper for the /api/servers/* functions: POST only, JSON in and
// out, ServerError -> its status, anything else -> 500.
import { dbAdapter } from './firebaseAdmin.js'
import { ServerError } from './servers.js'

export function handle(fn) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      res.status(200).json(await fn(dbAdapter(), body))
    } catch (err) {
      if (err instanceof ServerError) return res.status(err.status).json({ error: err.code })
      console.error(err)
      res.status(500).json({ error: 'server' })
    }
  }
}
