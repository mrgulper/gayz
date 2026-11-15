// Shared wrapper for the /api/servers/* functions: POST only, JSON in and
// out, ServerError -> its status, anything else -> 500.
import crypto from 'node:crypto'
import { dbAdapter } from './firebaseAdmin.js'
import { ServerError } from './servers.js'

// The asker's internet address (IP), scrambled (2026-11-15, IP bans in
// admin.js): a keyed hash, so the real address is never stored and can't
// be worked back out. Vercel sets x-real-ip / x-forwarded-for itself (a
// player can't fake them). No ADMIN_SECRET (tests, local) = no IP.
export function ipKey(req) {
  const secret = process.env.ADMIN_SECRET || ''
  const raw = String(req?.headers?.['x-real-ip'] || req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  if (secret.length < 16 || !raw) return null
  return crypto.createHmac('sha256', secret).update(`ip:${raw}`).digest('base64url').slice(0, 24)
}

export function handle(fn) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
      // Always overwritten, so a player can't send their own `_ip`.
      body._ip = ipKey(req)
      res.status(200).json(await fn(dbAdapter(), body))
    } catch (err) {
      if (err instanceof ServerError) return res.status(err.status).json({ error: err.code })
      console.error(err)
      res.status(500).json({ error: 'server' })
    }
  }
}
