// Shared Firebase Admin SDK setup for every /api/multiplayer/* function.
// Runs server-side ONLY (Vercel's servers, never the browser) - this is
// the whole point of this proxy: the FIREBASE_SERVICE_ACCOUNT_KEY secret
// (a real admin credential, set in Vercel's dashboard, never committed to
// the repo) never reaches client code, so no ad blocker or browser
// extension can ever see or block this connection - it isn't traffic the
// browser sends at all.
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'

const DATABASE_URL = 'https://gayz-aa69c-default-rtdb.firebaseio.com'

export function getAdminDb() {
  const existing = getApps()
  const app = existing.length
    ? getApp()
    : initializeApp({
        credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)),
        databaseURL: DATABASE_URL,
      })
  return getDatabase(app)
}
