// GET /api/auth/<discord|steam> - see api/_lib/oauth.js. Opened in a
// small sign-in window: the first visit sends the player to that site, the
// second (the site sending them back) ends on a page that passes a Firebase
// sign-in token to the game.
import crypto from 'node:crypto'
import { adminAuth } from '../_lib/firebaseAdmin.js'
import { PROVIDERS, AuthError, isCallback, missingKeys, firebaseUid, cleanProfile, sameState, resultPage } from '../_lib/oauth.js'

const STATE_COOKIE = 'gayz_auth_state'

function page(res, status, result) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).send(resultPage(result))
}

function cookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

async function saveUser(uid, profile) {
  const auth = adminAuth()
  try {
    await auth.updateUser(uid, profile)
  } catch (err) {
    if (err && err.code === 'auth/user-not-found') await auth.createUser({ uid, ...profile })
    else throw err
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x')
  const provider = url.pathname.split('/').pop()
  if (req.method !== 'GET' || !Object.hasOwn(PROVIDERS, provider)) return page(res, 404, { error: 'failed' })
  const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host}`
  const redirectUri = `${origin}/api/auth/${provider}`
  const env = process.env
  const query = url.searchParams

  if (!isCallback(provider, query)) {
    if (missingKeys(provider, env).length) return page(res, 503, { error: 'not-set-up' })
    const state = crypto.randomBytes(16).toString('hex')
    res.setHeader('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`)
    res.setHeader('Cache-Control', 'no-store')
    return res.redirect(302, PROVIDERS[provider].startUrl({ env, redirectUri, state, origin }))
  }

  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`)
  if (query.has('error')) return page(res, 200, { error: 'cancelled' })
  if (!sameState(query.get('state'), cookie(req, STATE_COOKIE))) return page(res, 400, { error: 'failed' })
  try {
    const user = await PROVIDERS[provider].finish({ env, query, redirectUri, fetch })
    const uid = firebaseUid(provider, user.id)
    await saveUser(uid, cleanProfile(user))
    const token = await adminAuth().createCustomToken(uid, { provider })
    return page(res, 200, { token })
  } catch (err) {
    if (!(err instanceof AuthError)) console.error(err)
    return page(res, err instanceof AuthError && err.code === 'cancelled' ? 200 : 502, { error: err instanceof AuthError ? err.code : 'failed' })
  }
}
