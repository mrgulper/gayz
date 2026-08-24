# Multiplayer Ad-Blocker-Proof Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route all multiplayer traffic through `gayz.vercel.app` itself (new Vercel serverless functions) instead of the browser talking to Firebase directly, so ad blockers that target Firebase's domain can no longer silently break position-syncing.

**Architecture:** Four new serverless functions under `/api/multiplayer/` use the Firebase Admin SDK (server-side only, never reaches the browser) to read/write the same Realtime Database Firebase already hosts. `src/game/Multiplayer.js` is rewritten to call these endpoints via `fetch()` instead of importing the Firebase client SDK. Live updates switch from a push-based subscription to polling (a merged "sync" call that writes your own state and returns everyone else's in one round trip). Player identity becomes a random ID our own `create`/`join` endpoints hand out, replacing Firebase Anonymous Auth.

**Tech Stack:** Vercel Serverless Functions (Node.js, ESM - this repo's `package.json` already has `"type": "module"`), `firebase-admin` (new dependency), Firebase Realtime Database (unchanged, same project).

**Spec:** `docs/superpowers/specs/2026-08-24-multiplayer-proxy-design.md`

## Global Constraints

- Browser must never make a direct network request to any `firebaseio.com` (or other Firebase) domain for multiplayer, after this plan is complete - that's the entire point of this work.
- Polling cadence: writes stay on the existing 100ms `_tick()` throttle; a player is considered disconnected (excluded from `sync` responses) after 2.5 seconds without an update (per spec's "2-3 second worst case").
- Same exported function names/shapes from `Multiplayer.js` wherever the spec doesn't call for a change (`createSession`, `joinSession`) - `Game.js`'s call sites for those two stay untouched.
- Every completed, working batch gets committed, pushed, and deployed to Vercel production without asking each time (this project's own standing rule, `CLAUDE.md`).
- Every task batch gets Gaymi (project owner, non-coder) exact click-by-click test steps, per this project's Vibecoding Rules A/G.
- The Firebase service account key (Task 1) is a real secret - never committed to the repo, only ever stored as a Vercel environment variable.

---

## File Structure

- **Create: `api/_lib/firebaseAdmin.js`** - shared Firebase Admin SDK initialization, reads the service account key from the environment, exposes `getAdminDb()`.
- **Create: `api/multiplayer/create.js`** - `POST` endpoint, creates a session.
- **Create: `api/multiplayer/join.js`** - `POST` endpoint, joins an existing session.
- **Create: `api/multiplayer/sync.js`** - `POST` endpoint, writes the caller's own state and returns everyone else's.
- **Create: `api/multiplayer/leave.js`** - `POST` endpoint, removes a player from a session.
- **Rewrite: `src/game/Multiplayer.js`** - drops all `firebase/app`/`firebase/auth`/`firebase/database` imports, calls the new endpoints via `fetch()` instead.
- **Modify: `src/game/Game.js`** - `_tick()`'s network-sync block, `_syncNetworkPlayerState()`, `_renderRemotePlayers()`, `_quitRunWithLegacyPayout()`'s cleanup block, and the constructor's multiplayer field list. Deletes `_ensureMultiplayerPlayerStatesSubscription()` entirely (no longer needed - `sync` returns states directly).
- **Modify: `package.json`** - adds `firebase-admin` as a dependency.

---

## Task 1: Firebase Admin setup + shared helper + the `create` endpoint

**Files:**
- Create: `api/_lib/firebaseAdmin.js`
- Create: `api/multiplayer/create.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `getAdminDb()` (from `api/_lib/firebaseAdmin.js`) → a Firebase Admin `Database` instance, used by every endpoint in later tasks. `POST /api/multiplayer/create` - body `{ nickname: string }` → `200 { sessionId: string, playerId: string }`, or `400 { error: string }` if `nickname` is missing.

- [ ] **Step 1: Generate the Firebase service account key (Gaymi does this - a real, one-time setup step)**

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and open the `gayz-aa69c` project (the same one Cloud Save and multiplayer already use).
2. Click the gear icon next to "Project Overview" (top left) → **Project settings**.
3. Click the **Service accounts** tab.
4. Click **Generate new private key** → confirm in the popup. A `.json` file downloads to your computer (something like `gayz-aa69c-firebase-adminsdk-xxxxx.json`).
5. **This file is a real secret** - it gives full admin access to the database. Don't share it, don't upload it anywhere public, don't paste it into this chat. We're about to store it somewhere safe (Vercel) instead of the code.
6. Open that downloaded file in any text editor (Notes, TextEdit, VS Code) and select-all + copy its entire contents (it's one big block of JSON text starting with `{` and ending with `}`).
7. Go to [vercel.com](https://vercel.com) → your `gayz` project → **Settings** tab → **Environment Variables** (left sidebar).
8. Add a new variable:
   - **Key:** `FIREBASE_SERVICE_ACCOUNT_KEY`
   - **Value:** paste the entire JSON you copied in step 6.
   - **Environments:** check all three boxes - Production, Preview, and Development.
9. Click **Save**.
10. You can now delete the downloaded `.json` file from your computer (it's safely stored in Vercel) - or keep it somewhere private if you want a backup, just never in this project's folder or anywhere that gets uploaded to GitHub.

- [ ] **Step 2: Install the Firebase Admin SDK package**

Run: `npm install firebase-admin`
Expected: adds `firebase-admin` to `package.json`'s `dependencies` and updates `package-lock.json` (or equivalent). No errors.

- [ ] **Step 3: Write the shared Admin SDK helper**

Create `api/_lib/firebaseAdmin.js`:

```js
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
```

- [ ] **Step 4: Write the `create` endpoint**

Create `api/multiplayer/create.js`:

```js
// POST { nickname } -> { sessionId, playerId }
// playerId is a random ID this endpoint mints - it replaces Firebase
// Anonymous Auth's uid. The browser never signs in to Firebase at all
// any more; this ID is the only thing proving "which player is this" on
// every later call (sync, leave), same spirit as a private room code.
import { randomUUID } from 'node:crypto'
import { getAdminDb } from '../_lib/firebaseAdmin.js'

const SESSION_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function generateSessionId() {
  const length = 6 + Math.floor(Math.random() * 5) // 6-10 inclusive, same shape as the old client-side generator
  let id = ''
  for (let i = 0; i < length; i++) id += SESSION_ID_CHARS[Math.floor(Math.random() * SESSION_ID_CHARS.length)]
  return id
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { nickname } = req.body || {}
  if (!nickname || typeof nickname !== 'string') {
    return res.status(400).json({ error: 'nickname is required' })
  }

  const db = getAdminDb()
  const sessionId = generateSessionId()
  const playerId = randomUUID()
  const now = Date.now()

  await db.ref(`multiplayerSessions/${sessionId}`).set({
    host: playerId,
    createdAt: now,
    players: {
      [playerId]: { nickname, joinedAt: now },
    },
  })

  res.status(200).json({ sessionId, playerId })
}
```

- [ ] **Step 5: Verify locally with `vercel dev`**

Run: `npx vercel dev --listen 3000 --yes`
(First run may prompt to link the project or confirm environment variables - accept the defaults, it's already linked to the `gayz` project.)

In a separate terminal, once it says it's ready:
```bash
curl -s -X POST http://localhost:3000/api/multiplayer/create \
  -H "Content-Type: application/json" \
  -d '{"nickname":"TestPlayer"}'
```
Expected: a JSON response like `{"sessionId":"AB12CD","playerId":"..."}` with no `error` field.

Then confirm the write actually landed in Firebase: open [console.firebase.google.com](https://console.firebase.google.com) → `gayz-aa69c` project → Realtime Database → Data tab → look for `multiplayerSessions` → the `sessionId` from the curl response should be there, with a `host`, `createdAt`, and a `players` entry matching the `playerId`.

Stop the `vercel dev` process (Ctrl+C) when done.

- [ ] **Step 6: Commit**

```bash
git add api/_lib/firebaseAdmin.js api/multiplayer/create.js package.json package-lock.json
git commit -m "Add Firebase Admin SDK helper and the multiplayer create endpoint"
```

**Gaymi's test for this batch:** Step 1 (the Firebase Console + Vercel dashboard steps) is the real hands-on part - follow it exactly, since everything else in this whole project depends on that key being stored correctly. Nothing to click in the game itself yet - this batch is pure backend plumbing, verified via the `curl` command in Step 5, not the game UI.

**Failure looks like:** the `curl` command returns an `error` field, or a connection error, or the Firebase Console never shows the new session. If `FIREBASE_SERVICE_ACCOUNT_KEY` is missing or malformed, the error will typically mention "Cannot read properties of undefined" or a JSON parse error - double-check Step 1's copy-paste (the whole file's contents, including the outer `{` and `}`).

---

## Task 2: `join`, `sync`, and `leave` endpoints

**Files:**
- Create: `api/multiplayer/join.js`
- Create: `api/multiplayer/sync.js`
- Create: `api/multiplayer/leave.js`

**Interfaces:**
- Consumes: `getAdminDb()` (Task 1).
- Produces: `POST /api/multiplayer/join` - body `{ sessionId, nickname }` → `200 { playerId }`, `404 { error: 'Session not found' }`, or `400 { error }` if fields are missing. `POST /api/multiplayer/sync` - body `{ sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring }` → `200 { states: { [otherPlayerId]: { x, y, z, rotY, currentWeapon, isFiring, updatedAt } } }` (excludes the caller's own entry and anyone stale for more than 2.5s), or `400 { error }`. `POST /api/multiplayer/leave` - body `{ sessionId, playerId }` → `200 { ok: true }`, or `400 { error }`.

- [ ] **Step 1: Write the `join` endpoint**

Create `api/multiplayer/join.js`:

```js
// POST { sessionId, nickname } -> { playerId }
// Joinable any time after a session is created - no lobby/status gate
// (removed earlier this project at Gaymi's request; see Multiplayer.js's
// own history for that decision).
import { randomUUID } from 'node:crypto'
import { getAdminDb } from '../_lib/firebaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, nickname } = req.body || {}
  if (!sessionId || !nickname) {
    return res.status(400).json({ error: 'sessionId and nickname are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  const snapshot = await sessionRef.once('value')
  if (!snapshot.exists()) {
    return res.status(404).json({ error: 'Session not found' })
  }

  const playerId = randomUUID()
  await sessionRef.child(`players/${playerId}`).set({ nickname, joinedAt: Date.now() })

  res.status(200).json({ playerId })
}
```

- [ ] **Step 2: Write the `sync` endpoint**

Create `api/multiplayer/sync.js`:

```js
// POST { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring }
//   -> { states: { [otherPlayerId]: {...} } }
// Merges what used to be two separate calls (updatePlayerState +
// subscribeToPlayerStates) into one round trip: write your own state,
// read everyone else's, in the same request. There's no live push
// connection any more (that's what made this whole feature reachable by
// ad blockers) - the client just calls this a few times a second and
// gets a fresh answer every time (polling).
import { getAdminDb } from '../_lib/firebaseAdmin.js'

// A player who hasn't sent an update in this long is treated as gone -
// the fallback for a crash/dropped connection that never got to send an
// explicit "leave" call. Deliberately short (see this project's spec,
// "Disconnect Handling") since a normal quit uses navigator.sendBeacon
// via the leave endpoint instead and doesn't rely on this timeout at all.
const STALE_MS = 2500

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  const now = Date.now()

  await sessionRef.child(`playerState/${playerId}`).set({
    x, y, z, rotY, currentWeapon, isFiring, updatedAt: now,
  })

  const snapshot = await sessionRef.child('playerState').once('value')
  const all = snapshot.val() || {}
  const states = {}
  for (const [otherId, state] of Object.entries(all)) {
    if (otherId === playerId) continue
    if (now - state.updatedAt > STALE_MS) continue
    states[otherId] = state
  }

  res.status(200).json({ states })
}
```

- [ ] **Step 3: Write the `leave` endpoint**

Create `api/multiplayer/leave.js`:

```js
// POST { sessionId, playerId } -> { ok: true }
// Called two ways from the game: a normal fetch() when leaving
// deliberately mid-session, and navigator.sendBeacon() specifically for
// the "quitting the game" moment (see Task 4) - sendBeacon is guaranteed
// by the browser to actually deliver even as the page is closing, unlike
// a normal fetch() racing a reload.
import { getAdminDb } from '../_lib/firebaseAdmin.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)
  await Promise.all([
    sessionRef.child(`players/${playerId}`).remove(),
    sessionRef.child(`playerState/${playerId}`).remove(),
  ])

  res.status(200).json({ ok: true })
}
```

- [ ] **Step 4: Verify all three locally with `vercel dev`**

Run: `npx vercel dev --listen 3000 --yes`

In another terminal:

```bash
# Create a session, capture its sessionId/playerId (host)
HOST=$(curl -s -X POST http://localhost:3000/api/multiplayer/create -H "Content-Type: application/json" -d '{"nickname":"Host"}')
echo "$HOST"
SESSION_ID=$(echo "$HOST" | python3 -c "import sys,json; print(json.load(sys.stdin)['sessionId'])")

# Join it as a second player
GUEST=$(curl -s -X POST http://localhost:3000/api/multiplayer/join -H "Content-Type: application/json" -d "{\"sessionId\":\"$SESSION_ID\",\"nickname\":\"Guest\"}")
echo "$GUEST"
GUEST_ID=$(echo "$GUEST" | python3 -c "import sys,json; print(json.load(sys.stdin)['playerId'])")

# Guest sends a sync
curl -s -X POST http://localhost:3000/api/multiplayer/sync -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$GUEST_ID\",\"x\":1,\"y\":0,\"z\":2,\"rotY\":0,\"currentWeapon\":\"melee\",\"isFiring\":false}"

# Host's own sync should now see the guest in its states
HOST_ID=$(echo "$HOST" | python3 -c "import sys,json; print(json.load(sys.stdin)['playerId'])")
curl -s -X POST http://localhost:3000/api/multiplayer/sync -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$HOST_ID\",\"x\":0,\"y\":0,\"z\":0,\"rotY\":0,\"currentWeapon\":\"melee\",\"isFiring\":false}"

# Guest leaves
curl -s -X POST http://localhost:3000/api/multiplayer/leave -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$GUEST_ID\"}"

# Host's sync should no longer see the guest
curl -s -X POST http://localhost:3000/api/multiplayer/sync -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"$SESSION_ID\",\"playerId\":\"$HOST_ID\",\"x\":0,\"y\":0,\"z\":0,\"rotY\":0,\"currentWeapon\":\"melee\",\"isFiring\":false}"
```

Expected: the host's sync BEFORE the guest leaves returns `states` containing the guest's `playerId` with `x:1,y:0,z:2`. The host's sync AFTER the guest leaves returns `states: {}` (empty).

Stop `vercel dev` (Ctrl+C) when done.

- [ ] **Step 5: Commit**

```bash
git add api/multiplayer/join.js api/multiplayer/sync.js api/multiplayer/leave.js
git commit -m "Add join, sync, and leave endpoints for the multiplayer proxy"
```

**Gaymi's test for this batch:** none yet in the game itself - this is the rest of the backend plumbing, verified via the curl commands in Step 4. The next batch is where the actual game starts using these.

**Failure looks like:** any curl response with an `error` field, or the host's second sync not showing the guest's data, or still showing the guest after they've left.

---

## Task 3: Rewrite `src/game/Multiplayer.js` to call the new API

**Files:**
- Modify: `src/game/Multiplayer.js` (full rewrite)

**Interfaces:**
- Consumes: the four endpoints from Tasks 1-2.
- Produces: `createSession(nickname)` → `Promise<{ sessionId, uid }>` (unchanged shape from before). `joinSession(sessionId, nickname)` → `Promise<{ uid }>` (unchanged shape). `syncPlayerState(sessionId, state)` → `Promise<states>` where `states` is an object keyed by other players' IDs (replaces the old separate `updatePlayerState`/`subscribeToPlayerStates` pair - Task 4 consumes this new merged function). `leave(sessionId)` → `Promise<void>` (replaces `leaveSession`/`removePlayerState`). `leaveBeacon(sessionId)` → `void`, synchronous, uses `navigator.sendBeacon` (Task 4 calls this specifically from the quit-to-menu path). `MULTIPLAYER_SECURITY_RULES` → the tightened deny-all rules string (Task 5 has Gaymi paste this into Firebase Console).

- [ ] **Step 1: Replace the entire file**

Replace all of `src/game/Multiplayer.js` with:

```js
// Multiplayer - routes everything through this site's own /api/multiplayer/*
// serverless functions instead of talking to Firebase directly from the
// browser. This exists specifically because ad blockers / privacy
// extensions commonly block firebaseio.com (Firebase Realtime Database's
// domain), which silently broke position-syncing for some players even
// though nothing about this traffic is ad- or tracking-related - see
// docs/superpowers/specs/2026-08-24-multiplayer-proxy-design.md.
//
// The actual data still lives in the same Firebase Realtime Database
// project as before - only the PATH there changed. The server-side half
// of this (api/_lib/firebaseAdmin.js + api/multiplayer/*.js) is what now
// talks to Firebase, using an admin credential that never reaches the
// browser, so no browser-side ad blocker can ever see or block it.
//
// Player identity is a random ID our own create/join endpoints hand out
// (replacing Firebase Anonymous Auth) - remembered here per session, the
// same role auth.uid used to play. This module stores it in _playerIdFor
// rather than requiring every caller in Game.js to track and pass it
// around themselves.

// SETUP (one-time, done by the project owner):
// 1. Firebase Console -> gear icon -> Project settings -> Service
//    accounts tab -> Generate new private key.
// 2. Vercel dashboard -> this project -> Settings -> Environment
//    Variables -> add FIREBASE_SERVICE_ACCOUNT_KEY, value = the entire
//    contents of that downloaded key file, for all three environments.
// 3. Realtime Database -> Rules tab -> paste MULTIPLAYER_SECURITY_RULES
//    (exported below) -> Publish. Safe to do any time after the server
//    endpoints are deployed and working - the Admin SDK bypasses these
//    rules entirely, they only ever governed direct client access, which
//    no longer happens at all.

// Deny-all: only the server's Admin SDK touches this data now (see the
// setup comment above) - there is no longer any legitimate reason for a
// browser to read or write this data directly, so this closes that off
// entirely rather than leaving an unused, unnecessarily-open door.
export const MULTIPLAYER_SECURITY_RULES = `{
  "rules": {
    "multiplayerSessions": {
      ".read": false,
      ".write": false
    }
  }
}`

async function _apiCall(path, body) {
  const res = await fetch(`/api/multiplayer/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

// sessionId -> playerId, set by createSession/joinSession, read by
// syncPlayerState/leave/leaveBeacon - this is this module's replacement
// for Firebase Auth's "who am I" concept, scoped per session instead of
// per browser tab.
const _playerIdFor = new Map()

export async function createSession(nickname) {
  const { sessionId, playerId } = await _apiCall('create', { nickname })
  _playerIdFor.set(sessionId, playerId)
  return { sessionId, uid: playerId }
}

export async function joinSession(sessionId, nickname) {
  const { playerId } = await _apiCall('join', { sessionId, nickname })
  _playerIdFor.set(sessionId, playerId)
  return { uid: playerId }
}

// Writes this player's own state and returns everyone else's current
// state in the same round trip - replaces the old separate
// updatePlayerState (write) + subscribeToPlayerStates (live subscribe)
// pair. There's no persistent connection any more; the caller (Game.js's
// _tick() throttle) is expected to call this repeatedly, a few times a
// second, and re-render from whatever it gets back each time.
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states } = await _apiCall('sync', { sessionId, playerId, ...state })
  return states
}

export async function leave(sessionId) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) return
  await _apiCall('leave', { sessionId, playerId })
  _playerIdFor.delete(sessionId)
}

// Synchronous, fire-and-forget version of leave() specifically for the
// "quitting the game" moment - navigator.sendBeacon() is a browser
// feature guaranteed to actually deliver the request even as the page is
// closing/reloading, unlike a normal fetch() (which can and does lose
// that race - see this codebase's own documented window.location.reload()
// hazard). No .catch() needed - sendBeacon doesn't return a promise to
// reject, just a boolean for whether the browser accepted queuing it.
export function leaveBeacon(sessionId) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) return
  const blob = new Blob([JSON.stringify({ sessionId, playerId })], { type: 'application/json' })
  navigator.sendBeacon('/api/multiplayer/leave', blob)
  _playerIdFor.delete(sessionId)
}
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds. (`Game.js` still calls the old `updatePlayerState`/`subscribeToPlayerStates`/`removePlayerState` names at this point - that's fixed in Task 4, not this one. If the build fails on those references, that's expected and fine; it's a build-syntax check on `Multiplayer.js` itself, not a full integration check yet.)

- [ ] **Step 3: Verify the rewritten module directly, without touching Game.js yet**

Run: `npx vercel dev --listen 3000 --yes` (this also serves the raw `/src/...` files the same way `vite dev` does, alongside the `/api` functions - needed here since the test below imports `Multiplayer.js` directly by path).

```python
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:3000')
    time.sleep(2)  # static page load, no game needed for this check

    result = page.evaluate("""async () => {
        const mp = await import('/src/game/Multiplayer.js')
        const { sessionId, uid } = await mp.createSession('TestPlayer')
        const states1 = await mp.syncPlayerState(sessionId, { x: 5, y: 0, z: 5, rotY: 0, currentWeapon: 'melee', isFiring: false })
        await mp.leave(sessionId)
        return { sessionId, uid, states1 }
    }""")
    print(result)
    browser.close()
```

Expected: prints an object with a real `sessionId`/`uid`, and `states1` is an empty object `{}` (no other players in this fresh session). No errors thrown.

Stop `vercel dev` (Ctrl+C) when done.

- [ ] **Step 4: Commit**

```bash
git add src/game/Multiplayer.js
git commit -m "Rewrite Multiplayer.js to route through the new API proxy instead of Firebase directly"
```

**Gaymi's test for this batch:** none yet in the actual game UI - `Game.js` still calls the old function names at this point (fixed in the next task), so the game itself is temporarily broken for multiplayer between this task and the next. That's expected and fine mid-batch; don't play-test multiplayer until Task 4 is also done.

**Failure looks like:** the Python script throws an error, or `states1` isn't an empty object.

---

## Task 4: Update `Game.js` to use the merged sync + sendBeacon leave

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `Multiplayer.syncPlayerState(sessionId, state)`, `Multiplayer.leaveBeacon(sessionId)` (Task 3).
- Produces: nothing new consumed by later tasks - this is the last code task, Task 5 is a deploy + rules-paste + verification only.

- [ ] **Step 1: Remove the now-unused constructor field**

Find in the constructor (alongside the other `_multiplayer*` field initializations):

```js
this._multiplayerSessionId = null
this._multiplayerUid = null
this._remotePlayerBodies = new Map() // uid -> PlayerBody
this._multiplayerPlayerStatesUnsubscribe = null
```

Replace with (drops the now-unused unsubscribe field - there's no persistent subscription any more, `sync` returns states directly on every call):

```js
this._multiplayerSessionId = null
this._multiplayerUid = null
this._remotePlayerBodies = new Map() // uid -> PlayerBody
```

- [ ] **Step 2: Update `_syncNetworkPlayerState` to call the merged endpoint and render directly**

Find:

```js
  // Streams this player's own position/facing/weapon/firing state a few
  // times a second (see _tick()'s throttle) while a multiplayer run is
  // active. Feet position, not eye position - same subtraction
  // _updateThirdPerson already uses for the local player's own body.
  _syncNetworkPlayerState() {
    if (!this._multiplayerSessionId) return
    const feetX = this.camera.position.x
    const feetY = this.camera.position.y - this.player.eyeHeight
    const feetZ = this.camera.position.z
    const yaw = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.updatePlayerState(this._multiplayerSessionId, {
        x: feetX,
        y: feetY,
        z: feetZ,
        rotY: yaw,
        currentWeapon: this.weapons.current.id,
        isFiring: !!this.weapons.triggerDown,
      }).catch(() => {})
    })
  }

  // Starts the remote-player render subscription. Called once, the first
  // time _syncNetworkPlayerState actually runs (i.e. once we know we're
  // really in a multiplayer run) rather than eagerly on every session -
  // _tick()'s own guard (this._multiplayerSessionId) already only calls
  // _syncNetworkPlayerState during real gameplay.
  _ensureMultiplayerPlayerStatesSubscription() {
    if (this._multiplayerPlayerStatesUnsubscribe || !this._multiplayerSessionId) return
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.subscribeToPlayerStates(this._multiplayerSessionId, (states) => {
        this._renderRemotePlayers(states)
      }).then((unsub) => { this._multiplayerPlayerStatesUnsubscribe = unsub })
    })
  }

  // One PlayerBody per remote uid, created lazily the first time that uid
  // is seen and reused after that - never recreated every update (that
  // would reload/re-clone the GLB skeleton every frame, expensive and
  // pointless). A uid that stops appearing in `states` (left the session,
  // or removePlayerState ran on their end) gets its body removed from the
  // scene and dropped from the map.
  _renderRemotePlayers(states) {
    const seenUids = new Set()
    for (const [uid, state] of Object.entries(states)) {
      if (uid === this._multiplayerUid) continue // never render my own body as a "remote" player
      seenUids.add(uid)
      let body = this._remotePlayerBodies.get(uid)
      if (!body) {
        body = new PlayerBody(this.scene)
        this._remotePlayerBodies.set(uid, body)
      }
      body.update(state.x, state.y, state.z, state.rotY, true)
    }
    for (const [uid, body] of this._remotePlayerBodies) {
      if (seenUids.has(uid)) continue
      body.group.parent?.remove(body.group)
      this._remotePlayerBodies.delete(uid)
    }
  }
```

Replace with (merges write+render into one flow, drops the now-deleted subscription method; `_renderRemotePlayers` no longer needs to filter out its own uid since `sync`'s response already excludes the caller server-side):

```js
  // Streams this player's own position/facing/weapon/firing state a few
  // times a second (see _tick()'s throttle) while a multiplayer run is
  // active, and renders whatever it gets back in the same call - there's
  // no separate live subscription any more (see
  // docs/superpowers/specs/2026-08-24-multiplayer-proxy-design.md): the
  // proxy is a polling API, not a push connection, so every sync call
  // both sends and receives. Feet position, not eye position - same
  // subtraction _updateThirdPerson already uses for the local player's
  // own body.
  _syncNetworkPlayerState() {
    if (!this._multiplayerSessionId) return
    const feetX = this.camera.position.x
    const feetY = this.camera.position.y - this.player.eyeHeight
    const feetZ = this.camera.position.z
    const yaw = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ').y
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.syncPlayerState(this._multiplayerSessionId, {
        x: feetX,
        y: feetY,
        z: feetZ,
        rotY: yaw,
        currentWeapon: this.weapons.current.id,
        isFiring: !!this.weapons.triggerDown,
      }).then((states) => {
        this._renderRemotePlayers(states)
      }).catch(() => {})
    })
  }

  // One PlayerBody per remote id, created lazily the first time that id
  // is seen and reused after that - never recreated every update (that
  // would reload/re-clone the GLB skeleton every frame, expensive and
  // pointless). An id that stops appearing in `states` (left the session,
  // disconnected, or went stale on the server) gets its body removed from
  // the scene and dropped from the map. `states` already excludes this
  // player's own id (the sync endpoint filters that out server-side), so
  // there's no self-check needed here any more.
  _renderRemotePlayers(states) {
    const seenIds = new Set()
    for (const [id, state] of Object.entries(states)) {
      seenIds.add(id)
      let body = this._remotePlayerBodies.get(id)
      if (!body) {
        body = new PlayerBody(this.scene)
        this._remotePlayerBodies.set(id, body)
      }
      body.update(state.x, state.y, state.z, state.rotY, true)
    }
    for (const [id, body] of this._remotePlayerBodies) {
      if (seenIds.has(id)) continue
      body.group.parent?.remove(body.group)
      this._remotePlayerBodies.delete(id)
    }
  }
```

- [ ] **Step 3: Update the `_tick()` throttle block**

Find:

```js
      const nowNet = performance.now()
      if (this._multiplayerSessionId && nowNet >= (this._nextNetworkSyncAt || 0)) {
        this._nextNetworkSyncAt = nowNet + 100
        this._syncNetworkPlayerState()
        this._ensureMultiplayerPlayerStatesSubscription()
      }
```

Replace with (drops the now-deleted subscription call - `_syncNetworkPlayerState` handles rendering itself now):

```js
      const nowNet = performance.now()
      if (this._multiplayerSessionId && nowNet >= (this._nextNetworkSyncAt || 0)) {
        this._nextNetworkSyncAt = nowNet + 100
        this._syncNetworkPlayerState()
      }
```

- [ ] **Step 4: Update the quit-to-menu cleanup**

Find in `_quitRunWithLegacyPayout()`:

```js
    if (this._multiplayerSessionId) {
      import('./Multiplayer.js').then((Multiplayer) => {
        Multiplayer.removePlayerState(this._multiplayerSessionId).catch(() => {})
      })
      this._multiplayerSessionId = null
    }
    if (this._multiplayerPlayerStatesUnsubscribe) {
      this._multiplayerPlayerStatesUnsubscribe()
      this._multiplayerPlayerStatesUnsubscribe = null
    }
    for (const body of this._remotePlayerBodies.values()) {
      body.group.parent?.remove(body.group)
    }
    this._remotePlayerBodies.clear()
```

Replace with (drops the unsubscribe cleanup - no longer exists; switches to the sendBeacon-based leave, which is synchronous and browser-guaranteed to deliver even through the reload a few lines later in this same method):

```js
    if (this._multiplayerSessionId) {
      import('./Multiplayer.js').then((Multiplayer) => {
        Multiplayer.leaveBeacon(this._multiplayerSessionId)
      })
      this._multiplayerSessionId = null
    }
    for (const body of this._remotePlayerBodies.values()) {
      body.group.parent?.remove(body.group)
    }
    this._remotePlayerBodies.clear()
```

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds, no references to the old `updatePlayerState`/`subscribeToPlayerStates`/`removePlayerState`/`_ensureMultiplayerPlayerStatesSubscription`/`_multiplayerPlayerStatesUnsubscribe` names remain anywhere in `Game.js`.

- [ ] **Step 6: Full two-browser verification against `vercel dev`**

Run: `npx vercel dev --listen 3000 --yes`

```python
from playwright.sync_api import sync_playwright
import time

def poll(fn, expect_truthy=True, timeout=20, interval=0.3):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        result = fn()
        if bool(result) == expect_truthy:
            return result
        time.sleep(interval)
    return result

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    guest_page = browser.new_page()
    host_page.goto('http://localhost:3000')
    poll(lambda: host_page.evaluate("() => !!window.__game"), timeout=30)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    session_id = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'HostPlayer'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session:", session_id)

    guest_page.goto('http://localhost:3000')
    poll(lambda: guest_page.evaluate("() => !!window.__game"), timeout=30)
    guest_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
    guest_page.evaluate(f"""async () => {{
        window.__game.settings.nickname = 'GuestPlayer'
        await window.__game._joinMultiplayerSession('{session_id}')
    }}""")

    for pg in (host_page, guest_page):
        pg.evaluate("""() => {
            window.__game.gameStarted = true
            window.__game.player.controls.isLocked = true
            window.__game.playerState.alive = true
            window.__game.inventoryOpen = false
            window.__game.perkPanelOpen = false
            window.__game.traderPanelOpen = false
            window.__game.xpLevelupPanelOpen = false
            window.__game.mapOpen = false
            window.__game.journalOpen = false
            window.__game.driving = false
            window.__game.photoModeOpen = false
            window.__game.spectateOpen = false
        }""")

    host_sees_guest = poll(lambda: host_page.evaluate("() => window.__game._remotePlayerBodies.size") == 1, timeout=20)
    guest_sees_host = poll(lambda: guest_page.evaluate("() => window.__game._remotePlayerBodies.size") == 1, timeout=20)
    print("host sees guest via the new proxy:", host_sees_guest)
    print("guest sees host via the new proxy:", guest_sees_host)

    # Confirm movement actually syncs through the new endpoint
    host_page.evaluate("() => { window.__game.camera.position.set(12, 1.7, 34) }")
    guest_moved = poll(lambda: guest_page.evaluate("""() => {
        const body = [...window.__game._remotePlayerBodies.values()][0]
        return body ? Math.abs(body.group.position.x - 12) < 0.01 : false
    }"""), timeout=10)
    print("guest's rendered copy of the host moved:", guest_moved)

    # Confirm quitting removes the body on the other side
    host_page.evaluate("() => { window.__game._quitRunWithLegacyPayout = window.__game._quitRunWithLegacyPayout.bind(window.__game) }")
    host_page.evaluate("""() => {
        // Call just the multiplayer-cleanup part directly rather than the
        // whole method (which also reloads the page, killing this test's
        // connection to it) - same "isolate what's actually being tested"
        // approach this project's own CLAUDE.md recommends for anything
        // that ends in a real reload.
        import('/src/game/Multiplayer.js').then((Multiplayer) => {
            Multiplayer.leaveBeacon(window.__game._multiplayerSessionId)
        })
    }""")
    guest_no_longer_sees_host = poll(lambda: guest_page.evaluate("() => window.__game._remotePlayerBodies.size") == 0, timeout=10)
    print("guest's copy of host disappears after host leaves:", guest_no_longer_sees_host)

    browser.close()
```

Expected: all four prints are `True` (or a real session id / `None` isn't printed for `session`).

- [ ] **Step 7: Commit**

```bash
git add src/game/Game.js
git commit -m "Update Game.js to use the merged sync + sendBeacon leave (multiplayer proxy)"
```

**Gaymi's test for this batch — the real payoff, needs two windows/a friend again, and works even with an ad blocker on:**
1. Start a run, press Escape, click Invite Friend - link appears automatically.
2. Click Start Playing - you go straight into the weapon picker.
3. Friend opens the link, clicks Join Game - they go straight into the weapon picker too.
4. Walk around - your friend should see a character model matching your movement, and vice versa, same as before.
5. Have one player quit to menu - their character should disappear from the other player's screen within a couple seconds.
6. **The actual fix:** if either of you has an ad blocker or privacy extension enabled, leave it ON this time (don't disable it) - it should now work anyway, since the game no longer talks to Firebase directly at all.

**Failure looks like:** same as before (no character appears, or it appears but never moves, or leaving doesn't remove it) - but this time, an ad blocker being on should no longer be a possible cause.

---

## Task 5: Tighten the security rules and ship it

**Files:**
- None (Gaymi does a manual Firebase Console step; this is a deploy + verification task, no code changes)

**Interfaces:**
- Consumes: `MULTIPLAYER_SECURITY_RULES` (Task 3's rewrite already contains the final, tightened deny-all string).

- [ ] **Step 1: Deploy to production**

```bash
npx vercel --prod --yes
```

Expected: deployment succeeds, prints the production URL (`gayz.vercel.app`).

- [ ] **Step 2: Gaymi re-pastes the tightened security rules into Firebase Console**

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → `gayz-aa69c` project → Realtime Database → **Rules** tab.
2. Select all the existing text in the box and delete it.
3. Paste this in:

```json
{
  "rules": {
    "multiplayerSessions": {
      ".read": false,
      ".write": false
    }
  }
}
```

4. Click **Publish**.

This is safe to do now (not before) - every player's browser talks only to `gayz.vercel.app`'s own API as of Task 4's deploy, never to Firebase directly, so there's nothing left that depends on direct client access. The Admin SDK the server functions use bypasses these rules entirely regardless of what they say.

- [ ] **Step 3: Final verification on the real production site**

```python
from playwright.sync_api import sync_playwright
import time

def poll(fn, expect_truthy=True, timeout=20, interval=0.3):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        result = fn()
        if bool(result) == expect_truthy:
            return result
        time.sleep(interval)
    return result

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    host_page.goto('https://gayz.vercel.app', timeout=60000)
    poll(lambda: host_page.evaluate("() => !!window.__game"), timeout=30)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    result = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'FinalCheck'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session created on production after rules were tightened:", result)
    browser.close()
```

Expected: prints a real session id, no error - proving the proxy works end-to-end on the real deployed site even with Firebase's rules fully locked down.

**Gaymi's test for this batch:** same as Task 4's test, but on the real `gayz.vercel.app` site instead of your local test server, with a real friend. If Task 4's test already passed locally, this step is mostly confirming nothing broke in the jump from local `vercel dev` to the real deployed site.

**Failure looks like:** the invite panel gets stuck on "Creating your invite link..." forever, or shows the "couldn't create an invite" error - would mean either the deploy didn't pick up the environment variable correctly, or the rules were pasted with a typo. Re-check Task 1's Vercel environment variable and this task's Step 2 rules paste.
