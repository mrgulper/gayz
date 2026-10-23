// Firebase Admin SDK for the /api/servers/* functions. Runs only on
// Vercel's servers: FIREBASE_SERVICE_ACCOUNT_KEY (a real admin credential,
// set in Vercel's dashboard, never committed) never reaches the browser,
// and the browser only ever talks to its own site - so ad blockers that
// block Firebase's own domains can't break servers (why the old
// multiplayer moved to this setup too).
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'
import { getAuth } from 'firebase-admin/auth'

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

// Firebase Auth admin, for the /api/auth/* sign-ins (Discord, Steam)
// that Firebase has no built-in button for: the server checks the player
// with that site, then hands the browser a Firebase sign-in token.
export function adminAuth() {
  return getAuth(adminApp())
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
