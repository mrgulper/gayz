// Cloud Save - Firebase Authentication (Google Sign-In) + Firestore.
//
// Firebase's free "Spark" plan needs no credit card and no billing account
// at all - Authentication and Firestore both have generous free quotas
// well beyond what a hobby game's save-sync needs. This replaced an
// earlier Google-Identity-Services-plus-Drive-appDataFolder design after
// hitting Google Cloud Console's separate "$300 free trial" onboarding
// wall (a different product, gated behind phone/card verification) -
// Firebase Console (console.firebase.google.com) doesn't have that wall.
//
// SETUP (one-time, done by the project owner, not by players):
// 1. https://console.firebase.google.com/ -> "Create a project" -> name it
//    (e.g. "gayz") -> you can decline Google Analytics, it's not needed.
// 2. Left sidebar -> "Build" -> "Authentication" -> "Get started" ->
//    "Sign-in method" tab -> enable "Google" -> pick a support email -> Save.
//    Firebase configures the underlying OAuth client for you - no manual
//    consent-screen setup needed.
// 3. Left sidebar -> "Build" -> "Firestore Database" -> "Create database" ->
//    pick any region close to your players -> start in **production mode**
//    (not test mode - production mode denies all access by default, which
//    is the safe starting point; see FIRESTORE_SECURITY_RULES below for the
//    exact rules this project needs, paste them into the "Rules" tab).
// 4. Project Settings (gear icon, top left) -> "General" tab -> scroll to
//    "Your apps" -> click the Web icon (</>) -> register an app (any
//    nickname) -> Firebase shows a `firebaseConfig` object. Copy every
//    field into FIREBASE_CONFIG below.
// 5. None of these values are secrets - Firebase's web config only says
//    "which project is this," not "who's allowed in." Real security comes
//    from the Firestore Security Rules (step 3), which is why those matter
//    much more than keeping this object private.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCCA9e3NAWk6MQJS-pnl-Lzq1Yn3nCZwVY',
  authDomain: 'gayz-aa69c.firebaseapp.com',
  projectId: 'gayz-aa69c',
  storageBucket: 'gayz-aa69c.firebasestorage.app',
  messagingSenderId: '539710194511',
  appId: '1:539710194511:web:51a5db83526e9445843b3a',
}

// Paste this exactly into Firebase Console -> Firestore Database -> Rules.
// Restricts every save document to only its own signed-in owner - without
// this (or left on Firestore's "test mode" default, which allows anyone to
// read/write anything), any player could read or overwrite any other
// player's cloud save.
export const FIRESTORE_SECURITY_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /saves/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}`

export function isConfigured() {
  return !FIREBASE_CONFIG.apiKey.startsWith('REPLACE_WITH_')
}

let appPromise = null

// Firebase's SDK is only imported (and its ~lazy-loaded chunk fetched) once
// actually needed, not on every page load - most visitors never open the
// Cloud Save panel, so there's no reason to pay for this bundle up front.
async function ensureApp() {
  if (appPromise) return appPromise
  appPromise = (async () => {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore'),
    ])
    const app = initializeApp(FIREBASE_CONFIG)
    const auth = authMod.getAuth(app)
    const db = fsMod.getFirestore(app)
    return { app, auth, db, authMod, fsMod }
  })()
  return appPromise
}

export async function signIn() {
  const { auth, authMod } = await ensureApp()
  const provider = new authMod.GoogleAuthProvider()
  const result = await authMod.signInWithPopup(auth, provider)
  const user = result.user
  return { uid: user.uid, profile: { name: user.displayName, email: user.email, picture: user.photoURL } }
}

export async function signOut() {
  const { auth, authMod } = await ensureApp()
  await authMod.signOut(auth)
}

// Fires immediately with the current user (or null) and again on every
// sign-in/sign-out/session-restore - Firebase persists auth state itself
// (IndexedDB), so unlike a raw OAuth access token this survives a page
// reload without needing our own "cached profile + silent re-auth" logic.
export async function onAuthChange(callback) {
  const { auth, authMod } = await ensureApp()
  return authMod.onAuthStateChanged(auth, (user) => {
    callback(user ? { uid: user.uid, profile: { name: user.displayName, email: user.email, picture: user.photoURL } } : null)
  })
}

// Returns { data, modifiedTime } or null if this account has never synced
// before. `data` is the same untrusted-JSON blob _exportSave()/
// _importSaveFile() already treat as untrusted (see CLAUDE.md's Import
// Save note) - a Firestore document the player's own account controls is
// no more trustworthy than a file they picked off disk.
export async function fetchCloudSave(uid) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDoc(fsMod.doc(db, 'saves', uid))
  if (!snap.exists()) return null
  const doc = snap.data()
  return { data: doc.data, modifiedTime: doc.updatedAt }
}

export async function pushCloudSave(uid, dataObj) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'saves', uid), { data: dataObj, updatedAt: Date.now() })
}
