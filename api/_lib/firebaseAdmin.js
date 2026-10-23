// Firebase Admin SDK for the /api/servers/* functions. Runs only on
// Vercel's servers: FIREBASE_SERVICE_ACCOUNT_KEY (a real admin credential,
// set in Vercel's dashboard, never committed) never reaches the browser,
// and the browser only ever talks to its own site - so ad blockers that
// block Firebase's own domains can't break servers (why the old
// multiplayer moved to this setup too).
import crypto from 'node:crypto'
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

const DATABASE_URL = 'https://gayz-aa69c-default-rtdb.firebaseio.com'

function adminApp() {
  return getApps().length
    ? getApp()
    : initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
        databaseURL: DATABASE_URL,
      })
}

function adminDb() {
  return getDatabase(adminApp())
}

// A Firebase sign-in ("custom") token for the /api/auth/* sign-ins (Discord,
// Steam): a JWT signed with the service account's own key - the same thing
// firebase-admin's createCustomToken makes. Done by hand because importing
// firebase-admin/auth crashed every /api function on Vercel (its jwks-rsa
// require()s the ES-module-only jose, 2026-10-23 - servers went down too).
export function createCustomToken(uid, claims = {}) {
  const key = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
  const now = Math.floor(Date.now() / 1000)
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: key.client_email,
    sub: key.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
    claims,
  })}`
  return `${body}.${crypto.sign('RSA-SHA256', Buffer.from(body), key.private_key).toString('base64url')}`
}

// The small interface api/_lib/servers.js is written against.
export function dbAdapter() {
  const db = adminDb()
  return {
    async get(path) {
      return (await db.ref(path).once('value')).val()
    },
    async update(paths) {
      if (Object.keys(paths).length) await db.ref().update(paths)
    },
  }
}
