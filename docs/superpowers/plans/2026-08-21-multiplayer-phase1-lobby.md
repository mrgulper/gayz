# Multiplayer Phase 1: Invite Link + Lobby — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player can open the pause menu, generate a shareable invite link, and have friends who open that link join a real-time lobby (Firebase Realtime Database) showing who's connected. The host clicks Start; everyone (including the host) then proceeds into their own normal solo run — there is no shared gameplay yet, this phase only proves people can find and see each other in one session.

**Architecture:** A new `src/game/Multiplayer.js` module (same shape as `CloudSync.js`) talks to Firebase Realtime Database. One player creates a session (gets a short session ID, becomes `host`), others join via `?join=<sessionId>` in the URL. All connected clients subscribe to the same `/multiplayerSessions/{sessionId}` node and re-render the player list live. No zombie/world sync in this phase — that's Phase 2+.

**Tech Stack:** Firebase Realtime Database (`firebase/database`), reusing the existing Firebase project and `firebase/app`/`firebase/auth` already wired up in `CloudSync.js`. Firebase Anonymous Authentication (new) so a player doesn't need a full Google sign-in just to join a friend's game.

**Spec:** `docs/superpowers/specs/2026-08-21-multiplayer-design.md`

## Global Constraints

- No unit test suite exists in this project — verification is by driving the real running game (see this project's own CLAUDE.md, "Playwright verification quirks" section). Every task below verifies via `page.evaluate()` against `window.__game`, not a test framework.
- Follow the codebase's existing per-subsystem-module convention (`CloudSync.js`, `WeaponMastery.js`, etc.) — all new Firebase RTDB logic lives in one new file, `src/game/Multiplayer.js`, not scattered into `Game.js`.
- **Critical Firebase gotcha, must be respected in Task 1:** `CloudSync.js`'s `ensureApp()` already calls `initializeApp(FIREBASE_CONFIG)` for the default Firebase app. Calling `initializeApp()` a second time for the same (unnamed/default) app throws `Firebase: Firebase App named '[DEFAULT]' already exists`. `Multiplayer.js` MUST NOT call `initializeApp()` blindly — it has to check `getApps()` first and reuse the existing app if `CloudSync.js`'s code already ran, exactly as written in Task 1.
- Nothing here changes what a solo (non-multiplayer) run does. A player who never touches the invite button sees zero behavior change.
- Per this project's own standing rule: every completed, working batch gets committed, pushed to GitHub, and deployed to Vercel without asking each time.
- Per Gaymi's (the project owner, a non-coder) profile: after each task batch, give exact click-by-click test steps covering everything in that batch, plus what success and failure look like.

---

## File Structure

- **Create: `src/game/Multiplayer.js`** — all Firebase Realtime Database logic: config, security rules string, session create/join/leave/subscribe/start functions. Nothing else touches Firebase RTDB directly.
- **Modify: `src/game/CloudSync.js`** — export `FIREBASE_CONFIG` (currently private) so `Multiplayer.js` can reuse the exact same project config instead of duplicating it.
- **Modify: `index.html`** — one new button in `#pause-overlay`, one new `#multiplayer-panel` (invite/create/lobby views).
- **Modify: `src/style.css`** — styling for `#multiplayer-panel` and its lobby player-list rows, following the existing shared modal-panel conventions already used by every other panel in this file.
- **Modify: `src/game/Game.js`** — element refs, event wiring, URL `?join=` detection on boot, panel open/close/render logic, the host's Start click handler.

---

## Task 1: Firebase setup — Realtime Database + Anonymous Auth (manual steps + config plumbing)

**Files:**
- Modify: `src/game/CloudSync.js` (export `FIREBASE_CONFIG`)
- Create: `src/game/Multiplayer.js` (config + app-reuse scaffold only, no session logic yet)

**Interfaces:**
- Produces: `Multiplayer.ensureDatabase()` — async, resolves to `{ app, db, dbMod }`. Later tasks call this before touching the database.
- Produces: `Multiplayer.MULTIPLAYER_DATABASE_URL` — placeholder constant Gaymi fills in by hand (see manual steps).
- Produces: `Multiplayer.MULTIPLAYER_SECURITY_RULES` — exported string, pasted into Firebase Console by hand.

### Gaymi's manual steps (must happen before this task's code will actually work — the code itself can still be written and committed first)

1. Go to https://console.firebase.google.com/ → open the existing "gayz" project (same one Cloud Save already uses — do NOT create a new project).
2. Left sidebar → "Build" → "Realtime Database" → "Create Database".
3. Pick a location close to your players (any region is fine) → **Start in locked mode** (denies all access by default — the safe starting point, same reasoning as Firestore's production mode).
4. Once created, the console shows a URL at the top that looks like `https://gayz-aa69c-default-rtdb.firebaseio.com` (or with a region in it, e.g. `...-default-rtdb.europe-west1.firebasedatabase.app`). Copy that exact URL — you'll paste it into the code in the next step below.
5. Left sidebar → "Build" → "Authentication" → "Sign-in method" tab → "Add new provider" → enable **Anonymous** → Save. (This lets a friend join a lobby without needing their own Google account — Google Sign-In stays as-is for everyone who already uses Cloud Save.)
6. Realtime Database → "Rules" tab → paste in the rules block this task's code exports as `MULTIPLAYER_SECURITY_RULES` (shown below) → Publish.

### Steps

- [ ] **Step 1: Export `FIREBASE_CONFIG` from CloudSync.js**

In `src/game/CloudSync.js`, change:
```js
const FIREBASE_CONFIG = {
```
to:
```js
export const FIREBASE_CONFIG = {
```
No other change to that object — same fields, same values.

- [ ] **Step 2: Create `src/game/Multiplayer.js` with app-reuse-safe database access**

```js
// Multiplayer (Phase 1: invite link + lobby) - Firebase Realtime Database,
// not Firestore (Cloud Save's product) - RTDB is built for fast streaming
// updates, which is what a live player list (and later, live zombie/loot
// state) needs. Same Firebase project as Cloud Save, different product.
//
// SETUP (one-time, done by the project owner - see this file's own PR/plan
// for the full walkthrough):
// 1. Firebase Console -> Build -> Realtime Database -> Create Database ->
//    locked mode. Copy the databaseURL it shows you into
//    MULTIPLAYER_DATABASE_URL below.
// 2. Firebase Console -> Build -> Authentication -> Sign-in method -> add
//    the Anonymous provider.
// 3. Realtime Database -> Rules tab -> paste MULTIPLAYER_SECURITY_RULES
//    (exported below) -> Publish.
import { FIREBASE_CONFIG } from './CloudSync.js'

// REPLACE_WITH_DATABASE_URL - fill this in after creating the Realtime
// Database in Firebase Console (see setup steps above). The app will
// throw a clear error on first use until this is set.
const MULTIPLAYER_DATABASE_URL = 'REPLACE_WITH_DATABASE_URL'

export const MULTIPLAYER_SECURITY_RULES = `{
  "rules": {
    "multiplayerSessions": {
      "$sessionId": {
        ".read": "auth != null && (data.child('players').child(auth.uid).exists() || !data.exists())",
        ".write": "auth != null && (!data.exists() || data.child('host').val() === auth.uid || (data.child('status').val() === 'lobby' && !data.child('players').child(auth.uid).exists() === false))",
        "host": {
          ".validate": "!data.parent().parent().child('host').exists() || newData.val() === data.parent().parent().child('host').val()"
        },
        "players": {
          "$uid": {
            ".write": "auth != null && auth.uid === $uid",
            ".read": "auth != null"
          }
        }
      }
    }
  }
}`

export function isConfigured() {
  return MULTIPLAYER_DATABASE_URL !== 'REPLACE_WITH_DATABASE_URL'
}

let dbPromise = null

// Mirrors CloudSync.js's ensureApp() lazy-import pattern, but MUST NOT call
// initializeApp() unconditionally - CloudSync.js's own ensureApp() may have
// already initialized the default Firebase app (e.g. the player opened
// Cloud Save or Friends before ever touching multiplayer). Calling
// initializeApp() twice for the same unnamed app throws
// `Firebase: Firebase App named '[DEFAULT]' already exists`. getApps()
// lets both modules safely share one instance regardless of which one
// runs first.
export async function ensureDatabase() {
  if (dbPromise) return dbPromise
  dbPromise = (async () => {
    const [appMod, dbMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/database'),
    ])
    const existing = appMod.getApps()
    const app = existing.length ? appMod.getApp() : appMod.initializeApp(FIREBASE_CONFIG)
    const db = dbMod.getDatabase(app, MULTIPLAYER_DATABASE_URL)
    return { app, db, dbMod }
  })()
  return dbPromise
}
```

- [ ] **Step 3: Verify the module loads without throwing**

Run: `npx vite build`
Expected: build succeeds (this step has no runtime Firebase call yet, so it can't fail on the placeholder URL - it only fails at runtime once `ensureDatabase()` is actually called, which no other code calls yet).

- [ ] **Step 4: Commit**

```bash
git add src/game/CloudSync.js src/game/Multiplayer.js
git commit -m "Add Multiplayer.js scaffold - Firebase RTDB config, app-reuse-safe init"
```

**Gaymi's test for this batch:** none yet — there's no button or UI wired up. Do the 6 manual Firebase Console steps above, send me the real `databaseURL` it gave you, and I'll paste it into `MULTIPLAYER_DATABASE_URL` in the next batch before anything is clickable.

---

## Task 2: Session create/join/subscribe functions

**Files:**
- Modify: `src/game/Multiplayer.js`

**Interfaces:**
- Consumes: `ensureDatabase()` from Task 1.
- Produces: `generateSessionId()` → string. `createSession(uid, nickname)` → Promise<sessionId>. `joinSession(sessionId, uid, nickname)` → Promise<void> (rejects if the session doesn't exist or has already started). `leaveSession(sessionId, uid)` → Promise<void>. `subscribeToSession(sessionId, callback)` → unsubscribe function; callback receives `{ host, status, players: [{uid, nickname, connected}] }` every time anything in the session changes. `startSession(sessionId, uid)` → Promise<void> (rejects if `uid` isn't the host).

- [ ] **Step 1: Add session ID generation, reusing the game's existing ID shape**

```js
// Same character set and length range as Game.js's own _generatePlayerId
// (friend/leaderboard IDs) - one consistent "short code" shape across the
// whole game rather than inventing a second format just for this.
const SESSION_ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateSessionId() {
  const length = 6 + Math.floor(Math.random() * 5) // 6-10 inclusive
  let id = ''
  for (let i = 0; i < length; i++) id += SESSION_ID_CHARS[Math.floor(Math.random() * SESSION_ID_CHARS.length)]
  return id
}
```

- [ ] **Step 2: Add createSession/joinSession/leaveSession**

```js
export async function createSession(uid, nickname) {
  const { db, dbMod } = await ensureDatabase()
  const sessionId = generateSessionId()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  await dbMod.set(sessionRef, {
    host: uid,
    createdAt: dbMod.serverTimestamp(),
    status: 'lobby',
    players: {
      [uid]: { nickname, joinedAt: dbMod.serverTimestamp(), connected: true },
    },
  })
  // Presence: if this tab closes/loses connection, flip connected false
  // automatically - Firebase runs this server-side the moment the socket
  // drops, no client-side cleanup code required.
  const presenceRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}/connected`)
  dbMod.onDisconnect(presenceRef).set(false)
  return sessionId
}

export async function joinSession(sessionId, uid, nickname) {
  const { db, dbMod } = await ensureDatabase()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  const snapshot = await dbMod.get(sessionRef)
  if (!snapshot.exists()) throw new Error('Session not found')
  if (snapshot.val().status !== 'lobby') throw new Error('Session already started')
  const playerRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}`)
  await dbMod.set(playerRef, { nickname, joinedAt: dbMod.serverTimestamp(), connected: true })
  const presenceRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}/connected`)
  dbMod.onDisconnect(presenceRef).set(false)
}

export async function leaveSession(sessionId, uid) {
  const { db, dbMod } = await ensureDatabase()
  const playerRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/players/${uid}`)
  await dbMod.remove(playerRef)
}
```

- [ ] **Step 3: Add subscribeToSession and startSession**

```js
export async function subscribeToSession(sessionId, callback) {
  const { db, dbMod } = await ensureDatabase()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  const unsubscribe = dbMod.onValue(sessionRef, (snapshot) => {
    if (!snapshot.exists()) {
      callback(null)
      return
    }
    const val = snapshot.val()
    const players = Object.entries(val.players || {}).map(([uid, p]) => ({
      uid, nickname: p.nickname, connected: p.connected !== false,
    }))
    callback({ host: val.host, status: val.status, players })
  })
  return unsubscribe
}

export async function startSession(sessionId, uid) {
  const { db, dbMod } = await ensureDatabase()
  const sessionRef = dbMod.ref(db, `multiplayerSessions/${sessionId}`)
  const snapshot = await dbMod.get(sessionRef)
  if (!snapshot.exists() || snapshot.val().host !== uid) throw new Error('Only the host can start the session')
  await dbMod.update(sessionRef, { status: 'active' })
}
```

- [ ] **Step 4: Verify with a real two-client Playwright check**

This is the first point real Firebase calls happen, so it needs the real `databaseURL` from Task 1's manual steps filled in first. Write and run as a throwaway script (not committed):

```python
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page1 = browser.new_page()
    page2 = browser.new_page()
    for page in (page1, page2):
        page.goto('http://localhost:5173')
    deadline = time.time() + 30
    while time.time() < deadline:
        if page1.evaluate("() => !!window.__game") and page2.evaluate("() => !!window.__game"):
            break
        page1.wait_for_timeout(500)

    session_id = page1.evaluate("""async () => {
        const mp = await import('/src/game/Multiplayer.js')
        return await mp.createSession('test-host-uid', 'HostPlayer')
    }""")
    print("session:", session_id)

    page2.evaluate(f"""async () => {{
        const mp = await import('/src/game/Multiplayer.js')
        await mp.joinSession('{session_id}', 'test-guest-uid', 'GuestPlayer')
    }}""")

    page1_view = page1.evaluate(f"""async () => {{
        const mp = await import('/src/game/Multiplayer.js')
        return await new Promise((resolve) => {{
            mp.subscribeToSession('{session_id}', (state) => {{ if (state && state.players.length === 2) resolve(state) }})
        }})
    }}""")
    print("host sees:", page1_view)
    assert len(page1_view['players']) == 2
    browser.close()
```

Expected: `host sees:` prints a session with both `HostPlayer` and `GuestPlayer` in `players`, `host` equal to `'test-host-uid'`, `status` equal to `'lobby'`.

- [ ] **Step 5: Commit**

```bash
git add src/game/Multiplayer.js
git commit -m "Add session create/join/leave/subscribe/start to Multiplayer.js"
```

**Gaymi's test for this batch:** still none clickable yet — this batch is pure plumbing, verified by the Playwright script above, not by hand. Next batch adds the actual buttons and screens.

---

## Task 3: Invite button + Create/Join panel UI

**Files:**
- Modify: `index.html`
- Modify: `src/style.css`
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `Multiplayer.createSession`, `Multiplayer.joinSession`, `Multiplayer.generateSessionId` (not called directly, `createSession` does it), from Task 2.
- Produces: `Game._openMultiplayerPanel()`, `Game._closeMultiplayerPanel()` — later tasks (lobby rendering) hook into the same panel this task creates.

- [ ] **Step 1: Add the pause-menu button**

In `index.html`, inside `#pause-overlay`'s `.perk-panel-buttons` (right after `#pause-resume-btn`, matching this project's existing pattern of new pause options going in that same button row):

```html
<button id="pause-invite-btn">Invite Friend</button>
```

- [ ] **Step 2: Add the multiplayer panel markup**

Add this as a new top-level panel div in `index.html`, in the same panel-group area as `#credits-panel`/`#rulesinfo-panel` (same shared modal-panel styling group):

```html
<div id="multiplayer-panel">
  <h2 id="multiplayer-panel-title">Play with Friends</h2>
  <div id="multiplayer-create-view">
    <p id="multiplayer-create-desc">Invite a friend to join your game.</p>
    <button id="multiplayer-create-btn">Create Invite Link</button>
  </div>
  <div id="multiplayer-link-view" style="display: none">
    <p id="multiplayer-link-desc">Send this link to a friend:</p>
    <div id="multiplayer-link-row">
      <input type="text" id="multiplayer-link-input" readonly />
      <button id="multiplayer-copy-link-btn" class="mini-action-btn">Copy</button>
    </div>
  </div>
  <div id="multiplayer-lobby-view" style="display: none">
    <h3 id="multiplayer-lobby-title">Lobby</h3>
    <div id="multiplayer-player-list"></div>
    <button id="multiplayer-start-btn" style="display: none">Start Game</button>
    <p id="multiplayer-waiting-line" style="display: none">Waiting for the host to start...</p>
  </div>
  <p class="panel-close-hint">Click anywhere to close</p>
</div>
```

- [ ] **Step 3: Add `#multiplayer-panel` to the shared panel-group CSS selector list**

In `src/style.css`, find the shared selector list starting with `#trader-panel,` / `#credits-panel,` (base modal panel styling: `position:absolute; inset:0; z-index:15; display:none; flex-direction:column; align-items:center; justify-content:center;...`). Add `#multiplayer-panel,` to that list, same as every other panel.

- [ ] **Step 4: Style the link row and player list**

```css
#multiplayer-link-row {
  display: flex;
  gap: 8px;
  width: 100%;
  max-width: 360px;
}

#multiplayer-link-input {
  flex: 1;
  padding: 8px 12px;
  font-size: 13px;
  color: #e8e8e2;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
}

#multiplayer-player-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-width: 320px;
  margin: 10px 0;
}

.multiplayer-player-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
}

.multiplayer-player-row .friend-status-dot {
  background: #4caf50;
}

.multiplayer-player-row.disconnected .friend-status-dot {
  background: #6b6b6b;
}

.multiplayer-player-row.is-host::after {
  content: 'HOST';
  margin-left: auto;
  font-size: 10px;
  letter-spacing: 0.5px;
  color: #e3c23c;
}
```

- [ ] **Step 5: Wire element refs and open/close in Game.js**

Add near the other panel element refs (same block as `this.creditsPanel = ...`):

```js
this.pauseInviteBtn = document.getElementById('pause-invite-btn')
this.multiplayerPanel = document.getElementById('multiplayer-panel')
this.multiplayerPanelTitle = document.getElementById('multiplayer-panel-title')
this.multiplayerCreateView = document.getElementById('multiplayer-create-view')
this.multiplayerCreateBtn = document.getElementById('multiplayer-create-btn')
this.multiplayerLinkView = document.getElementById('multiplayer-link-view')
this.multiplayerLinkInput = document.getElementById('multiplayer-link-input')
this.multiplayerCopyLinkBtn = document.getElementById('multiplayer-copy-link-btn')
this.multiplayerLobbyView = document.getElementById('multiplayer-lobby-view')
this.multiplayerPlayerList = document.getElementById('multiplayer-player-list')
this.multiplayerStartBtn = document.getElementById('multiplayer-start-btn')
this.multiplayerWaitingLine = document.getElementById('multiplayer-waiting-line')
this._multiplayerSessionId = null
this._multiplayerUnsubscribe = null
```

Add these methods (same file, alongside the other `_open*Panel`/`_close*Panel` pairs):

```js
_openMultiplayerPanel() {
  if (!this.multiplayerPanel) return
  this._closeAllMenuPanels()
  this.multiplayerPanel.style.display = 'flex'
  this.multiplayerPanelTitle.textContent = t('multiplayerPanelTitle')
  this.multiplayerCreateView.style.display = 'flex'
  this.multiplayerLinkView.style.display = 'none'
  this.multiplayerLobbyView.style.display = 'none'
}

_closeMultiplayerPanel() {
  if (this.multiplayerPanel) this.multiplayerPanel.style.display = 'none'
}
```

Add `if (this.multiplayerPanel) this._closeMultiplayerPanel()` to `_closeAllMenuPanels()`, matching every other panel entry there.

- [ ] **Step 6: Add `multiplayerPanelTitle` i18n key**

In `src/game/i18n.js`'s English block, near the other panel-title keys:
```js
multiplayerPanelTitle: 'Play with Friends',
```

- [ ] **Step 7: Wire the pause-menu button and Create click**

```js
if (this.pauseInviteBtn) this.pauseInviteBtn.addEventListener('click', () => this._openMultiplayerPanel())
if (this.multiplayerPanel) {
  this.multiplayerPanel.addEventListener('click', (e) => {
    if (e.target === this.multiplayerPanel) this._closeMultiplayerPanel()
  })
}
if (this.multiplayerCreateBtn) {
  this.multiplayerCreateBtn.addEventListener('click', async () => {
    const Multiplayer = await import('./Multiplayer.js')
    const uid = this._cloudUid || this.settings.playerId
    const nickname = this.settings.nickname || 'Player'
    const sessionId = await Multiplayer.createSession(uid, nickname)
    this._multiplayerSessionId = sessionId
    const link = `${window.location.origin}${window.location.pathname}?join=${sessionId}`
    this.multiplayerLinkInput.value = link
    this.multiplayerCreateView.style.display = 'none'
    this.multiplayerLinkView.style.display = 'flex'
  })
}
if (this.multiplayerCopyLinkBtn) {
  this.multiplayerCopyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(this.multiplayerLinkInput.value)
      .then(() => this._showLoreToast(t('multiplayerLinkCopied')))
      .catch(() => {})
  })
}
```

Add the new toast key in `i18n.js` alongside the button's:
```js
multiplayerLinkCopied: 'Invite link copied!',
```

- [ ] **Step 8: Build and verify no errors**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 9: Commit**

```bash
git add index.html src/style.css src/game/Game.js src/game/i18n.js
git commit -m "Add Invite Friend button, create-session panel and link UI"
```

**Gaymi's test for this batch:**
1. Start a run (or use the pause menu from an active run).
2. Press Escape to open the pause menu.
3. Click "Invite Friend" — a panel titled "Play with Friends" should open with a "Create Invite Link" button.
4. Click "Create Invite Link" — the view should switch to show a text box with a long link starting with your site's address and `?join=`, plus a "Copy" button.
5. Click "Copy" — a small toast message should appear saying "Invite link copied!"
6. Click anywhere outside the panel — it should close.

**Failure looks like:** the button doesn't appear, clicking it does nothing, "Create Invite Link" errors out (check the browser console), or no link appears in the box.

---

## Task 4: Lobby player list + join flow + Start

**Files:**
- Modify: `index.html` (join-confirmation view for a guest arriving via link)
- Modify: `src/game/Game.js`
- Modify: `src/game/i18n.js`

**Interfaces:**
- Consumes: `Multiplayer.joinSession`, `Multiplayer.subscribeToSession`, `Multiplayer.startSession`, `Multiplayer.leaveSession` from Task 2; `_openMultiplayerPanel`/`_closeMultiplayerPanel` from Task 3.
- Produces: `Game._joinMultiplayerSession(sessionId)`, `Game._renderMultiplayerLobby(state)`, `Game._startMultiplayerLobby()` (host-only click handler) — these complete Phase 1; Phase 2 builds on top of `_multiplayerSessionId` being set.

- [ ] **Step 1: Detect `?join=` on page load**

In `src/game/Game.js`'s constructor (near where other one-time boot checks already happen, e.g. after `window.__game = this` is set), add:

```js
const joinParam = new URLSearchParams(window.location.search).get('join')
if (joinParam) this._pendingJoinSessionId = joinParam
```

- [ ] **Step 2: Show a join-confirmation view when a pending join exists**

Add to `#multiplayer-panel` in `index.html`, as a new sibling view:

```html
<div id="multiplayer-join-view" style="display: none">
  <p id="multiplayer-join-desc">You've been invited to a game.</p>
  <button id="multiplayer-join-btn">Join Game</button>
</div>
```

Add the element ref and wire it in Game.js:

```js
this.multiplayerJoinView = document.getElementById('multiplayer-join-view')
this.multiplayerJoinBtn = document.getElementById('multiplayer-join-btn')
```

Update `_openMultiplayerPanel()` to check for a pending join first:

```js
_openMultiplayerPanel() {
  if (!this.multiplayerPanel) return
  this._closeAllMenuPanels()
  this.multiplayerPanel.style.display = 'flex'
  this.multiplayerPanelTitle.textContent = t('multiplayerPanelTitle')
  this.multiplayerLinkView.style.display = 'none'
  this.multiplayerLobbyView.style.display = 'none'
  if (this._pendingJoinSessionId) {
    this.multiplayerCreateView.style.display = 'none'
    this.multiplayerJoinView.style.display = 'flex'
  } else {
    this.multiplayerCreateView.style.display = 'flex'
    this.multiplayerJoinView.style.display = 'none'
  }
}
```

Also call `this._openMultiplayerPanel()` once automatically right after the game finishes constructing, only if `this._pendingJoinSessionId` is set (so a friend clicking the link sees the Join prompt immediately rather than having to find the pause menu themselves) - add near the end of the constructor, after `window.__game = this`:

```js
if (this._pendingJoinSessionId) this._openMultiplayerPanel()
```

- [ ] **Step 3: Implement join + lobby subscription**

```js
async _joinMultiplayerSession(sessionId) {
  const Multiplayer = await import('./Multiplayer.js')
  const uid = this._cloudUid || this.settings.playerId
  const nickname = this.settings.nickname || 'Player'
  try {
    await Multiplayer.joinSession(sessionId, uid, nickname)
  } catch (err) {
    this._showLoreToast(t('multiplayerJoinFailed'))
    return
  }
  this._multiplayerSessionId = sessionId
  this._subscribeMultiplayerLobby(Multiplayer, sessionId)
  this.multiplayerJoinView.style.display = 'none'
  this.multiplayerLinkView.style.display = 'none'
  this.multiplayerCreateView.style.display = 'none'
  this.multiplayerLobbyView.style.display = 'flex'
}

_subscribeMultiplayerLobby(Multiplayer, sessionId) {
  const uid = this._cloudUid || this.settings.playerId
  Multiplayer.subscribeToSession(sessionId, (state) => {
    if (!state) return
    this._renderMultiplayerLobby(state, uid)
  }).then((unsub) => { this._multiplayerUnsubscribe = unsub })
}

_renderMultiplayerLobby(state, myUid) {
  this.multiplayerPlayerList.innerHTML = state.players.map((p) => `
    <div class="multiplayer-player-row${p.connected ? '' : ' disconnected'}${p.uid === state.host ? ' is-host' : ''}">
      <span class="friend-status-dot"></span>
      <span>${_escapeHtml(p.nickname)}</span>
    </div>
  `).join('')
  const isHost = state.host === myUid
  this.multiplayerStartBtn.style.display = isHost ? 'block' : 'none'
  this.multiplayerWaitingLine.style.display = isHost ? 'none' : 'block'
}
```

- [ ] **Step 4: Wire the Join and Start buttons, and hook Create into the same lobby subscription**

```js
if (this.multiplayerJoinBtn) {
  this.multiplayerJoinBtn.addEventListener('click', () => {
    if (this._pendingJoinSessionId) this._joinMultiplayerSession(this._pendingJoinSessionId)
  })
}
if (this.multiplayerStartBtn) {
  this.multiplayerStartBtn.addEventListener('click', async () => {
    const Multiplayer = await import('./Multiplayer.js')
    const uid = this._cloudUid || this.settings.playerId
    await Multiplayer.startSession(this._multiplayerSessionId, uid)
    this._closeMultiplayerPanel()
    // Phase 1 has no shared gameplay yet - starting just closes the lobby
    // and lets each player's own game proceed exactly as a solo run does
    // today. Phase 2 replaces this line with the real shared-start flow.
  })
}
```

Replace the ENTIRE `multiplayerCreateBtn` click handler added in Task 3 Step 7 with this updated version (adds the lobby subscription call, everything else about it is unchanged):

```js
if (this.multiplayerCreateBtn) {
  this.multiplayerCreateBtn.addEventListener('click', async () => {
    const Multiplayer = await import('./Multiplayer.js')
    const uid = this._cloudUid || this.settings.playerId
    const nickname = this.settings.nickname || 'Player'
    const sessionId = await Multiplayer.createSession(uid, nickname)
    this._multiplayerSessionId = sessionId
    const link = `${window.location.origin}${window.location.pathname}?join=${sessionId}`
    this.multiplayerLinkInput.value = link
    this.multiplayerCreateView.style.display = 'none'
    this.multiplayerLinkView.style.display = 'flex'
    this._subscribeMultiplayerLobby(Multiplayer, sessionId)
  })
}
```

Add a "Continue to Lobby" button to `#multiplayer-link-view` in index.html - the complete updated view (was added in Task 3 Step 2) is:

```html
<div id="multiplayer-link-view" style="display: none">
  <p id="multiplayer-link-desc">Send this link to a friend:</p>
  <div id="multiplayer-link-row">
    <input type="text" id="multiplayer-link-input" readonly />
    <button id="multiplayer-copy-link-btn" class="mini-action-btn">Copy</button>
  </div>
  <button id="multiplayer-continue-to-lobby-btn">Continue to Lobby</button>
</div>
```

Add its element ref in Game.js, in the same block as the other `multiplayer*` refs from Task 3 Step 5:

```js
this.multiplayerContinueToLobbyBtn = document.getElementById('multiplayer-continue-to-lobby-btn')
```

Wire its click handler, alongside the other multiplayer button handlers added in this task:

```js
if (this.multiplayerContinueToLobbyBtn) {
  this.multiplayerContinueToLobbyBtn.addEventListener('click', () => {
    this.multiplayerLinkView.style.display = 'none'
    this.multiplayerLobbyView.style.display = 'flex'
  })
}
```

- [ ] **Step 5: Add the last i18n key**

```js
multiplayerJoinFailed: "Couldn't join - the game may have already started or the link may be wrong.",
```

- [ ] **Step 6: Two-browser end-to-end Playwright verification**

```python
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    guest_page = browser.new_page()
    host_page.goto('http://localhost:5173')

    deadline = time.time() + 30
    while time.time() < deadline:
        if host_page.evaluate("() => !!window.__game"):
            break
        host_page.wait_for_timeout(500)

    host_page.evaluate("() => { document.getElementById('asset-loader').style.display = 'none' }")
    host_page.evaluate("() => { window.__game.gameStarted = true; window.__game._openMultiplayerPanel() }")
    host_page.click('#multiplayer-create-btn')
    host_page.wait_for_timeout(500)
    link = host_page.evaluate("() => document.getElementById('multiplayer-link-input').value")
    print("invite link:", link)
    assert '?join=' in link

    guest_page.goto(link)
    deadline = time.time() + 30
    while time.time() < deadline:
        if guest_page.evaluate("() => !!window.__game"):
            break
        guest_page.wait_for_timeout(500)
    guest_page.evaluate("() => { document.getElementById('asset-loader').style.display = 'none' }")
    guest_page.wait_for_timeout(500)
    join_view_visible = guest_page.evaluate("() => getComputedStyle(document.getElementById('multiplayer-join-view')).display")
    print("guest join view display:", join_view_visible)
    guest_page.click('#multiplayer-join-btn')
    guest_page.wait_for_timeout(1000)

    host_page.click('#multiplayer-continue-to-lobby-btn')
    host_page.wait_for_timeout(1000)
    host_rows = host_page.evaluate("() => document.querySelectorAll('.multiplayer-player-row').length")
    guest_rows = guest_page.evaluate("() => document.querySelectorAll('.multiplayer-player-row').length")
    print("host sees", host_rows, "players; guest sees", guest_rows, "players")
    assert host_rows == 2 and guest_rows == 2

    host_start_visible = host_page.evaluate("() => getComputedStyle(document.getElementById('multiplayer-start-btn')).display")
    guest_start_visible = guest_page.evaluate("() => getComputedStyle(document.getElementById('multiplayer-start-btn')).display")
    print("host start button:", host_start_visible, "| guest start button:", guest_start_visible)
    assert host_start_visible != 'none' and guest_start_visible == 'none'

    browser.close()
```

Expected: both assertions pass, host sees the Start button, guest sees "Waiting for the host..." instead.

- [ ] **Step 7: Commit**

```bash
git add index.html src/game/Game.js src/game/i18n.js
git commit -m "Add multiplayer lobby: join flow, live player list, host-only Start"
```

**Gaymi's test for this batch (needs a second device or a friend, or two browser windows on your own computer):**
1. In one browser window, start a run, press Escape, click "Invite Friend", click "Create Invite Link", then "Continue to Lobby". You should see a "Lobby" screen with your own name listed and a "Start Game" button.
2. Copy the link (from the previous batch's Copy button, or right-click the address bar in the Link view if you skipped it) and open it in a second browser window (or send it to a friend).
3. In the second window, you should immediately see a "You've been invited to a game" screen with a "Join Game" button. Click it.
4. Back in the FIRST window's Lobby screen, the second player's name should appear in the list within a couple seconds, without refreshing.
5. In the second window, you should see the same two-player list, but with "Waiting for the host to start..." instead of a Start button.
6. In the first window (the host), click "Start Game" — the lobby should close. (Nothing else happens yet in this phase — that's expected, actual shared gameplay is a later phase.)

**Failure looks like:** the second player never appears in the first window's list (or vice versa), the Start button shows up for the wrong person, or either window shows a console error.
