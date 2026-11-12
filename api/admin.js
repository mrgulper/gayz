// POST /api/admin - the Console's admin controls (api/_lib/admin.js).
// Locked with ADMIN_SECRET (a Vercel Environment Variable on both this
// site and the Console, never in code): only the Console's own server
// knows it, the Console's page never sees it. Body: { action, ...args }.
import crypto from 'node:crypto'
import { dbAdapter } from './_lib/firebaseAdmin.js'
import { ServerError } from './_lib/servers.js'
import { ADMIN_ACTIONS } from './_lib/admin.js'
import * as firestoreRest from './_lib/firestoreRest.js'

function secretOk(given) {
  const real = process.env.ADMIN_SECRET || ''
  if (real.length < 16 || typeof given !== 'string') return false
  const a = crypto.createHash('sha256').update(given).digest()
  const b = crypto.createHash('sha256').update(real).digest()
  return crypto.timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  if (!process.env.ADMIN_SECRET) return res.status(503).json({ error: 'not-set-up' })
  if (!secretOk(req.headers['x-admin-secret'])) return res.status(401).json({ error: 'wrong-secret' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    const fn = ADMIN_ACTIONS[body.action]
    if (!fn) return res.status(400).json({ error: 'bad-action' })
    res.status(200).json(await fn(dbAdapter(), body, firestoreRest))
  } catch (err) {
    if (err instanceof ServerError) return res.status(err.status).json({ error: err.code })
    console.error(err)
    res.status(500).json({ error: 'server' })
  }
}
