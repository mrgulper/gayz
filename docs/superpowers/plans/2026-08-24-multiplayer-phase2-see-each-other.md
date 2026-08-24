# Multiplayer Phase 2: See Each Other — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a host starts a shared run (from the Phase 1 lobby), every player's position/rotation/weapon/firing state streams over Firebase Realtime Database, and every other player sees a real 3D character model of them moving around in their own copy of the world in real time. Zombies stay independent per client in this phase - not synced yet (that's Phase 3).

**Architecture:** Every connected client writes its own `playerState/{myUid}` a few times a second while playing (position, facing direction, equipped weapon, whether they're firing) and subscribes to everyone else's. For each other uid seen, a `PlayerBody` instance (the same "no AI, just a renderable body" class already used for the local player's own third-person camera view) is created, positioned, and animated purely from that streamed data - no local simulation of remote players at all.

**Tech Stack:** Firebase Realtime Database (continuing on `src/game/Multiplayer.js` from Phase 1), `PlayerBody` (`src/game/PlayerBody.js`, already built and already preloaded at boot - no new 3D asset work).

**Spec:** `docs/superpowers/specs/2026-08-21-multiplayer-design.md`

## Global Constraints

- No unit test suite exists in this project - verification is by driving the real running game (this project's own CLAUDE.md, "Playwright verification quirks" section). Every task below verifies via `page.evaluate()` against `window.__game`, not a test framework.
- **Critical pointer-lock gotcha, must be respected in Task 2:** starting a run ends in `this.player.controls.lock()` (a real `requestPointerLock()` call), which browsers only allow inside a live user-gesture ("user activation") window. The host's "Start Game" button click IS a real gesture - but only if nothing `await`s a Promise *before* the click chain that leads to `lock()` runs; an `await` can let the gesture's activation window expire before the synchronous chain resumes. The guest never gets a gesture at all from Firebase's `onValue` callback (it's an async network event, not a click) - the guest's own run must only ever start from a real click on a new "Join Now" button shown to them, never automatically. Both of these are handled explicitly in Task 2 and Task 3 - do not "simplify" by awaiting the Firebase call before the click chain, and do not auto-start the guest's run from the subscription callback.
- Follows the codebase's existing per-subsystem-module convention - all new Firebase RTDB logic stays in `src/game/Multiplayer.js` (already established in Phase 1), not scattered into `Game.js`.
- Per this project's own standing rule: every completed, working batch gets committed, pushed to GitHub, and deployed to Vercel without asking each time.
- Per Gaymi's (the project owner, a non-coder) profile: after each task batch, give exact click-by-click test steps covering everything in that batch, plus what success and failure look like.
- The world is not flat (skyscrapers, stairs, multiple floors) - unlike the design doc's original `playerState` schema (`x, z, rotY, health, currentWeapon, isFiring`, no vertical position), this plan adds `y` to the streamed state. `PlayerBody.update()` needs a real feet height to place a remote player on the right floor, not just x/z.

---

## File Structure

- **Modify: `src/game/Multiplayer.js`** — add `updatePlayerState(sessionId, state)`, `subscribeToPlayerStates(sessionId, callback)`, `removePlayerState(sessionId)`; extend `MULTIPLAYER_SECURITY_RULES` with a `playerState` block (same per-uid-owns-its-own-node pattern as Phase 1's `players` block).
- **Modify: `index.html`** — add a "Host started the game! Join Now" button to the lobby view's guest-facing state (replaces the plain "Waiting for the host to start..." line once the session goes active).
- **Modify: `src/game/Game.js`** — host-side Start now actually starts a run (not just closes the panel); guest-side "Join Now" button wired to the same real run-start flow; a throttled per-frame send of the local player's own state while a multiplayer run is active; receiving and rendering every other player's `PlayerBody`, including adding a new one when someone joins mid-run and removing one when someone disconnects.

---

## Task 1: RTDB player-state read/write/subscribe functions + security rules

**Files:**
- Modify: `src/game/Multiplayer.js`

**Interfaces:**
- Consumes: `ensureContext()`, `ensureSignedIn()` (private/internal to Multiplayer.js already, from Phase 1).
- Produces: `updatePlayerState(sessionId, state)` → Promise<void>, where `state` is `{ x, y, z, rotY, currentWeapon, isFiring }`. `subscribeToPlayerStates(sessionId, callback)` → Promise<unsubscribe function>; callback receives an object keyed by uid: `{ [uid]: { x, y, z, rotY, currentWeapon, isFiring, updatedAt } }`, called every time anything in `playerState` changes (a single onValue listener on the whole `playerState` node, not one listener per player). `removePlayerState(sessionId)` → Promise<void> (called when leaving/ending a session, so a stale position doesn't linger for others).

- [ ] **Step 1: Extend the security rules**

In `src/game/Multiplayer.js`, replace the existing `MULTIPLAYER_SECURITY_RULES` export with this (adds the `playerState` block, otherwise unchanged from Phase 1):

```js
export const MULTIPLAYER_SECURITY_RULES = `{
  "rules": {
    "multiplayerSessions": {
      "$sessionId": {
        ".read": "auth != null",
        ".write": "auth != null && (!data.exists() || data.child('host').val() === auth.uid)",
        "host": {
          ".validate": "!data.parent().parent().child('host').exists() || newData.val() === data.parent().parent().child('host').val()"
        },
        "players": {
          "$uid": {
            ".write": "auth != null && auth.uid === $uid",
            ".read": "auth != null"
          }
        },
        "playerState": {
          "$uid": {
            ".write": "auth != null && auth.uid === $uid",
            ".read": "auth != null"
          }
        }
      }
    }
  }
}`
```

- [ ] **Step 2: Add the player-state functions**

Add these to the end of `src/game/Multiplayer.js` (after the existing `startSession` function):

```js
// Streamed a few times a second while a shared run is active (see
// Game.js's _tick() throttle) - one player's own position/facing/weapon/
// firing state. updatedAt lets a future phase detect a stale/stuck
// player (e.g. one whose tab froze) without needing presence tracking
// beyond what Phase 1's players/{uid}/connected already gives.
// Tracks which sessionId already has an onDisconnect() cleanup hook
// registered, so updatePlayerState (called ~10x/second from _tick()'s
// throttle) doesn't re-register it on every single call.
const _disconnectHookRegisteredFor = new Set()

export async function updatePlayerState(sessionId, state) {
  const { db, dbMod } = await ensureContext()
  const uid = await ensureSignedIn()
  const stateRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/playerState/${uid}`)
  if (!_disconnectHookRegisteredFor.has(sessionId)) {
    _disconnectHookRegisteredFor.add(sessionId)
    // This is the reliable cleanup path, not the explicit removePlayerState()
    // call Game.js makes on a graceful Quit to Menu - that call races
    // against _quitRunWithLegacyPayout()'s own window.location.reload()
    // (a real, already-documented hazard in this codebase - a reload can
    // tear down the page before an in-flight async write finishes) and
    // wouldn't fire at all for a closed tab or crashed browser. RTDB runs
    // onDisconnect() hooks server-side the moment the connection actually
    // drops, regardless of why - same pattern Phase 1 already uses for
    // players/{uid}/connected.
    dbMod.onDisconnect(stateRef).remove()
  }
  await dbMod.set(stateRef, { ...state, updatedAt: dbMod.serverTimestamp() })
}

export async function subscribeToPlayerStates(sessionId, callback) {
  const { db, dbMod } = await ensureContext()
  const statesRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/playerState`)
  const unsubscribe = dbMod.onValue(statesRef, (snapshot) => {
    callback(snapshot.val() || {})
  })
  return unsubscribe
}

export async function removePlayerState(sessionId) {
  const { db, dbMod } = await ensureContext()
  const uid = await ensureSignedIn()
  const stateRef = dbMod.ref(db, `multiplayerSessions/${sessionId}/playerState/${uid}`)
  await dbMod.remove(stateRef)
}
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds (these functions aren't called from anywhere yet, so this only checks for syntax errors).

- [ ] **Step 4: Commit**

```bash
git add src/game/Multiplayer.js
git commit -m "Add playerState read/write/subscribe to Multiplayer.js (Phase 2)"
```

**Gaymi's test for this batch:** none yet - this is backend plumbing only, nothing clickable changed. The next batch is where the security rules need to be re-pasted into Firebase Console (same place as before - Realtime Database → Rules tab) before anything in Phase 2 can actually work; that instruction comes with the batch that first calls these functions for real, not this one, since nothing calls them yet.

---

## Task 2: Host's "Start Game" actually starts a shared run

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `Multiplayer.startSession(sessionId)` (Phase 1).
- Produces: nothing new consumed by later tasks - this task's change is self-contained (host behavior only). Task 3 does the equivalent for the guest, independently.

- [ ] **Step 1: Replace the Start button's click handler**

Find the existing handler (added in Phase 1's plan, Task 4):

```js
if (this.multiplayerStartBtn) {
  this.multiplayerStartBtn.addEventListener('click', async () => {
    const Multiplayer = await import('./Multiplayer.js')
    await Multiplayer.startSession(this._multiplayerSessionId)
    this._closeMultiplayerPanel()
    // Phase 1 has no shared gameplay yet - starting just closes the
    // lobby and lets each player's own game proceed exactly as a solo
    // run does today. Phase 2 replaces this with the real shared-start
    // flow (see docs/superpowers/specs/2026-08-21-multiplayer-design.md).
  })
}
```

Replace it with:

```js
if (this.multiplayerStartBtn) {
  this.multiplayerStartBtn.addEventListener('click', () => {
    // playBtn.click() MUST happen synchronously, before any await - the
    // real run-start chain ends in a requestPointerLock() call several
    // clicks later (see the weapon-picker and trait-draw panels' own
    // handlers), and browsers only allow that inside a live user-gesture
    // window. Awaiting the Firebase call first would risk that window
    // closing before playBtn's own click-triggered chain gets to run.
    const sessionId = this._multiplayerSessionId
    this._closeMultiplayerPanel()
    if (this.playBtn) this.playBtn.click()
    // Marks the session active for every other connected player - fired
    // off after the click chain, not awaited by it. A failure here just
    // means guests never see the "Join Now" prompt (Task 3) - it doesn't
    // block the host's own run from starting.
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.startSession(sessionId).catch(() => {})
    })
  })
}
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "Host's Start Game button now actually starts a run (Phase 2)"
```

**Gaymi's test for this batch:**
1. Start a run, press Escape, click "Invite Friend" (you'll get a link automatically now - no extra click needed).
2. Click "Continue to Lobby".
3. Click "Start Game".
4. You should see the normal weapon-picker screen appear (same one you'd see starting any new run), NOT just get dumped back at the pause menu like before.
5. Pick a weapon, pick a trait like normal - you should end up back in the game, playing, exactly like starting any solo run.

**Failure looks like:** clicking Start Game does nothing, or throws you back to the homepage instead of the weapon picker.

---

## Task 3: Guest's "Join Now" prompt + starting their own run

**Files:**
- Modify: `index.html`
- Modify: `src/game/Game.js`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `_renderMultiplayerLobby` (Phase 1, `Game.js`), `state.status` (already delivered by `subscribeToSession`, Phase 1 - just never read before now).
- Produces: nothing new consumed by later tasks.

- [ ] **Step 1: Add the Join Now button to the lobby view**

In `index.html`, find `#multiplayer-lobby-view` (added in Phase 1's plan):

```html
<div id="multiplayer-lobby-view" style="display: none">
  <h3 id="multiplayer-lobby-title">Lobby</h3>
  <div id="multiplayer-player-list"></div>
  <button id="multiplayer-start-btn" style="display: none">Start Game</button>
  <p id="multiplayer-waiting-line" style="display: none">Waiting for the host to start...</p>
</div>
```

Replace it with (adds the new button, everything else unchanged):

```html
<div id="multiplayer-lobby-view" style="display: none">
  <h3 id="multiplayer-lobby-title">Lobby</h3>
  <div id="multiplayer-player-list"></div>
  <button id="multiplayer-start-btn" style="display: none">Start Game</button>
  <p id="multiplayer-waiting-line" style="display: none">Waiting for the host to start...</p>
  <button id="multiplayer-join-now-btn" style="display: none">Host started the game! Join Now</button>
</div>
```

- [ ] **Step 2: Style the new button to stand out from the plain Start button**

Add to `src/style.css`, near the end of the file:

```css
#multiplayer-join-now-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  color: #0c130c;
  background: #7fd8a0;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

#multiplayer-join-now-btn:hover {
  background: #93e0b1;
}
```

- [ ] **Step 3: Wire the element ref and click handler**

Add the element ref in `Game.js`, alongside the other `multiplayer*` refs from Phase 1 (same block as `this.multiplayerWaitingLine = document.getElementById('multiplayer-waiting-line')`):

```js
this.multiplayerJoinNowBtn = document.getElementById('multiplayer-join-now-btn')
```

Add the click handler, alongside the other multiplayer button handlers from Phase 1's Task 4:

```js
if (this.multiplayerJoinNowBtn) {
  this.multiplayerJoinNowBtn.addEventListener('click', () => {
    // Same reasoning as the host's Start Game handler in Task 2 - click
    // playBtn synchronously, before anything async, to stay inside this
    // click's real user-gesture window.
    this._closeMultiplayerPanel()
    if (this.playBtn) this.playBtn.click()
  })
}
```

- [ ] **Step 4: Show the button once the session goes active**

Find `_renderMultiplayerLobby` (Phase 1, `Game.js`):

```js
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

Replace it with (adds the active-session branch for non-host players):

```js
_renderMultiplayerLobby(state, myUid) {
  this.multiplayerPlayerList.innerHTML = state.players.map((p) => `
    <div class="multiplayer-player-row${p.connected ? '' : ' disconnected'}${p.uid === state.host ? ' is-host' : ''}">
      <span class="friend-status-dot"></span>
      <span>${_escapeHtml(p.nickname)}</span>
    </div>
  `).join('')
  const isHost = state.host === myUid
  const isActive = state.status === 'active'
  this.multiplayerStartBtn.style.display = isHost ? 'block' : 'none'
  this.multiplayerWaitingLine.style.display = (!isHost && !isActive) ? 'block' : 'none'
  this.multiplayerJoinNowBtn.style.display = (!isHost && isActive) ? 'block' : 'none'
}
```

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 6: Two-browser Playwright verification**

```python
from playwright.sync_api import sync_playwright
import time

def poll(fn, expect_truthy=True, timeout=15, interval=0.3):
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
    host_page.goto('http://localhost:5173')
    poll(lambda: host_page.evaluate("() => !!window.__game"), timeout=30)
    host_page.evaluate("""() => {
        const l = document.getElementById('asset-loader')
        if (l) l.style.display = 'none'
        window.__game.gameStarted = true
        window.__game.pauseOverlay.style.display = 'flex'
        window.__game._openMultiplayerPanel()
    }""")
    link = poll(lambda: host_page.evaluate("() => document.getElementById('multiplayer-link-input').value") or None, timeout=15)

    guest_page.goto(link)
    poll(lambda: guest_page.evaluate("() => !!window.__game"), timeout=30)
    guest_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
    guest_page.click('#multiplayer-join-btn')
    poll(lambda: guest_page.evaluate("() => document.querySelectorAll('.multiplayer-player-row').length") == 2, timeout=10)

    host_page.click('#multiplayer-continue-to-lobby-btn')
    poll(lambda: host_page.evaluate("() => document.querySelectorAll('.multiplayer-player-row').length") == 2, timeout=10)

    join_now_visible_before = guest_page.evaluate("() => getComputedStyle(document.getElementById('multiplayer-join-now-btn')).display")
    print("guest Join Now button before host starts (should be none):", join_now_visible_before)

    host_page.click('#multiplayer-start-btn')

    join_now_visible_after = poll(lambda: guest_page.evaluate(
        "() => getComputedStyle(document.getElementById('multiplayer-join-now-btn')).display !== 'none'"
    ), timeout=10)
    print("guest sees 'Join Now' after host starts:", join_now_visible_after)

    browser.close()
```

Expected: `join_now_visible_before` prints `none`, `join_now_visible_after` prints `True`.

- [ ] **Step 7: Commit**

```bash
git add index.html src/game/Game.js src/style.css
git commit -m "Guest sees a real Join Now prompt once the host starts (Phase 2)"
```

**Gaymi's test for this batch (two windows/devices again, same as Phase 1's test):**
1. Same as before: create an invite, get a friend (or a second window) into the lobby.
2. On the host's side, click Start Game and go through the weapon-picker/trait-draw screens as normal.
3. On the guest's side (the one who joined via the link), within a couple seconds you should see the "Waiting for the host to start..." line change to a green **"Host started the game! Join Now"** button.
4. Click it - you should see the same weapon-picker screen the host saw, pick your own weapon/trait, and end up playing too.

**Failure looks like:** the guest's screen never changes from "Waiting...", or clicking Join Now does nothing.

---

## Task 4: Send local player state while a shared run is active

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `Multiplayer.updatePlayerState(sessionId, state)` (Task 1), `Multiplayer.removePlayerState(sessionId)` (Task 1).
- Produces: nothing new consumed by later tasks - Task 5 reads the same RTDB data independently via its own subscription, not through this task's code directly.

- [ ] **Step 1: Add the throttled send inside `_tick()`**

In `Game.js`'s `_tick()`, find the hotbar HUD throttle (already existing, Phase 1's research pointed at this exact spot):

```js
const nowHotbar = performance.now()
if (nowHotbar >= (this._nextHotbarHudAt || 0)) {
  this._nextHotbarHudAt = nowHotbar + 200
  this._updateHotbarHud()
}
```

Add this immediately after it (same `if (this.player.controls.isLocked && this.playerState.alive && ...)` gated block, so it only runs during real active gameplay):

```js
const nowNet = performance.now()
if (this._multiplayerSessionId && nowNet >= (this._nextNetworkSyncAt || 0)) {
  this._nextNetworkSyncAt = nowNet + 100
  this._syncNetworkPlayerState()
}
```

- [ ] **Step 2: Add the `_syncNetworkPlayerState` method**

Add this method near `_subscribeMultiplayerLobby` in `Game.js`:

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
```

- [ ] **Step 3: Stop sending state when a run ends**

Find `_quitRunWithLegacyPayout` in `Game.js` (the method the Quit to Menu button calls). Add this at its start, before anything else in the method runs. This is a best-effort *immediate* cleanup for the graceful-quit case - it races against this same method's own `window.location.reload()` at the end and may not always win that race, which is exactly why `updatePlayerState`'s `onDisconnect()` hook (Task 1) exists as the reliable fallback that fires either way:

```js
if (this._multiplayerSessionId) {
  import('./Multiplayer.js').then((Multiplayer) => {
    Multiplayer.removePlayerState(this._multiplayerSessionId).catch(() => {})
  })
  this._multiplayerSessionId = null
}
```

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 5: Real-Firebase verification (single browser, checking the write itself)**

```python
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    deadline = time.time() + 30
    while time.time() < deadline:
        if page.evaluate("() => !!window.__game"):
            break
        page.wait_for_timeout(500)
    page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    result = page.evaluate("""async () => {
        const mp = await import('/src/game/Multiplayer.js')
        const { sessionId } = await mp.createSession('TestPlayer')
        window.__game._multiplayerSessionId = sessionId
        window.__game._syncNetworkPlayerState()
        await new Promise((r) => setTimeout(r, 1000))
        const states = await new Promise((resolve) => {
            mp.subscribeToPlayerStates(sessionId, (s) => resolve(s))
        })
        return { sessionId, states }
    }""")
    print(result)
    browser.close()
```

Expected: `states` contains one entry (keyed by a uid) with numeric `x`/`y`/`z`/`rotY`, a `currentWeapon` string, and `isFiring: false`.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "Send local player state to RTDB while a multiplayer run is active (Phase 2)"
```

**Gaymi's test for this batch:** nothing new to click yet - this only sends data, nothing renders it until the next task. No visible change in the game.

---

## Task 5: Render every other player's PlayerBody from their streamed state

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `Multiplayer.subscribeToPlayerStates(sessionId, callback)` (Task 1), `PlayerBody` class (already imported in `Game.js` for the local player's own body - confirm the import exists, it's used at `this.playerBody = new PlayerBody(this.scene)`).

- [ ] **Step 1: Add remote-player tracking state**

Add near the other `_multiplayer*` field initializations in the constructor (same block as `this._multiplayerUid = null`):

```js
this._remotePlayerBodies = new Map() // uid -> PlayerBody
this._multiplayerPlayerStatesUnsubscribe = null
```

- [ ] **Step 2: Subscribe to player states once a run starts**

Find `_syncNetworkPlayerState` (Task 4) and add a new method right after it in `Game.js`:

```js
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

- [ ] **Step 3: Call the subscription starter from the same `_tick()` throttle block**

In `_tick()`, find the block added in Task 4:

```js
const nowNet = performance.now()
if (this._multiplayerSessionId && nowNet >= (this._nextNetworkSyncAt || 0)) {
  this._nextNetworkSyncAt = nowNet + 100
  this._syncNetworkPlayerState()
}
```

Replace it with (adds the one-time subscription call, everything else unchanged):

```js
const nowNet = performance.now()
if (this._multiplayerSessionId && nowNet >= (this._nextNetworkSyncAt || 0)) {
  this._nextNetworkSyncAt = nowNet + 100
  this._syncNetworkPlayerState()
  this._ensureMultiplayerPlayerStatesSubscription()
}
```

- [ ] **Step 4: Clean up remote bodies when a run ends**

Find `_quitRunWithLegacyPayout` (Task 4's Step 3 already added a block at its start). Add this right after that same block (still near the start of the method, before the rest of its existing logic):

```js
if (this._multiplayerPlayerStatesUnsubscribe) {
  this._multiplayerPlayerStatesUnsubscribe()
  this._multiplayerPlayerStatesUnsubscribe = null
}
for (const body of this._remotePlayerBodies.values()) {
  body.group.parent?.remove(body.group)
}
this._remotePlayerBodies.clear()
```

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 6: Full two-browser Playwright verification - the real Phase 2 milestone**

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
    host_page.goto('http://localhost:5173')
    poll(lambda: host_page.evaluate("() => !!window.__game"), timeout=30)
    host_page.evaluate("""() => {
        const l = document.getElementById('asset-loader')
        if (l) l.style.display = 'none'
    }""")

    # Simulate two players already in an active session, without going
    # through the full UI click chain (headless Playwright can't grant
    # real pointer lock - see this project's own CLAUDE.md gotcha) - set
    # the multiplayer session id directly on each game instance instead,
    # same "force the flag, don't fight headless limitations" precedent
    # already used elsewhere in this codebase's own test scripts.
    session_id = host_page.evaluate("""async () => {
        const mp = await import('/src/game/Multiplayer.js')
        const { sessionId, uid } = await mp.createSession('HostPlayer')
        window.__game._multiplayerSessionId = sessionId
        window.__game._multiplayerUid = uid
        window.__game.gameStarted = true
        return sessionId
    }""")

    guest_page.goto('http://localhost:5173')
    poll(lambda: guest_page.evaluate("() => !!window.__game"), timeout=30)
    guest_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
    guest_page.evaluate(f"""async () => {{
        const mp = await import('/src/game/Multiplayer.js')
        const {{ uid }} = await mp.joinSession('{session_id}', 'GuestPlayer')
        window.__game._multiplayerSessionId = '{session_id}'
        window.__game._multiplayerUid = uid
        window.__game.gameStarted = true
    }}""")

    # Drive a few real _tick() throttled sends from each side directly,
    # rather than waiting on the real 100ms in-game throttle (real render
    # loop is also running, but calling this directly makes the test
    # deterministic instead of racing the loop's own timing).
    host_page.evaluate("() => { window.__game._syncNetworkPlayerState(); window.__game._ensureMultiplayerPlayerStatesSubscription() }")
    guest_page.evaluate("() => { window.__game._syncNetworkPlayerState(); window.__game._ensureMultiplayerPlayerStatesSubscription() }")

    host_sees_guest_body = poll(lambda: host_page.evaluate(
        "() => window.__game._remotePlayerBodies.size"
    ) == 1, timeout=15)
    guest_sees_host_body = poll(lambda: guest_page.evaluate(
        "() => window.__game._remotePlayerBodies.size"
    ) == 1, timeout=15)
    print("host has 1 remote PlayerBody (the guest):", host_sees_guest_body)
    print("guest has 1 remote PlayerBody (the host):", guest_sees_host_body)

    # Move the host and confirm the guest's rendered copy of them moves too
    host_page.evaluate("() => { window.__game.camera.position.set(12, 1.7, 34); window.__game._syncNetworkPlayerState() }")
    guest_moved = poll(lambda: guest_page.evaluate("""() => {
        const body = [...window.__game._remotePlayerBodies.values()][0]
        return body ? Math.abs(body.group.position.x - 12) < 0.01 : false
    }"""), timeout=10)
    print("guest's rendered copy of the host moved to match the host's new position:", guest_moved)

    browser.close()
```

Expected: all three prints are `True`.

- [ ] **Step 7: Commit**

```bash
git add src/game/Game.js
git commit -m "Render every other player's real position as a PlayerBody (Phase 2)"
```

**Gaymi's test for this batch — the real payoff, needs two windows/a friend again:**
1. Get both players through the full flow from Task 2/3's tests, all the way into actually playing (past the weapon picker, in the game world).
2. Have one player walk around. On the OTHER player's screen, you should see a character model walking around in roughly the same spot, matching your friend's real movement, within a second or so.
3. Have both players walk toward each other and stand close - you should see your friend's character model right in front of you, facing whichever direction they're actually looking.
4. Have one player quit to menu (Quit to Menu button) - their character model should disappear from the other player's screen within a couple seconds.

**Failure looks like:** no second character model ever appears, it appears but never moves, or it's stuck in the wrong spot (e.g. always at 0,0,0 instead of where your friend actually is).

**What Phase 2 still doesn't do** (expected, not a bug): the remote player's model won't play a shooting animation yet, zombies are still completely separate per player (you won't see the SAME zombies your friend sees), and there's no name tag over their head yet. All of that is later work, not this phase.
