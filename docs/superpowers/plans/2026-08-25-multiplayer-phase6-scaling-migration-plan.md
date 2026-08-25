# Multiplayer Phase 6: Scaling & Host Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirm and fix any single-guest-shaped assumptions so a session supports any number of players, and build seamless host migration - if the host disconnects, the earliest-joined remaining player automatically and invisibly takes over running the world simulation.

**Architecture:** The host already broadcasts a rendering-only snapshot of the world (zombie position/health/type, loot position, etc.) to every player via a shared polling sync. This phase (a) confirms that mechanism already generalizes past 2 players (it mostly does - verified during design), and (b) extends the broadcast to carry full simulation state (status effects, cooldowns, spawn-director timers), so every guest is always "warm" with near-real-time full state. When the host disappears (detected via the existing staleness-filtering the sync endpoint already does), the earliest-joined remaining player claims the host role through a new transactional endpoint, then upgrades its own already-rendered zombie/world objects in place into fully-simulated ones using that warm state - no visual reset, no rebuild from scratch.

**Tech Stack:** Vite/vanilla JS, Three.js, Vercel serverless functions (Firebase Admin SDK proxy, Firebase Realtime Database), Playwright for verification.

**Spec:** `docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md`

## Global Constraints

- Any object keyed by a plain incrementing counter (zombie ids, pickup ids, etc.) must use a non-numeric-prefixed key when stored in Firebase RTDB - a bare-numeric-string-keyed object silently becomes a JSON array with `null` gaps otherwise. Every existing broadcast already follows this (`'z'+id`, `'p'+id`, `'g'+id`); anything new keyed the same way must too.
- This project's established security posture is "trusted friends in a private room code, no heavy anti-cheat" (explicit in Phase 3's own spec) - verify staleness and use atomic operations where correctness genuinely requires it (the host-claim race), but don't build validation beyond what's actually needed for correctness.
- **`performance.now()` is a per-tab-relative clock, not synchronized across browsers.** Every zombie status-effect/cooldown timestamp (`enragedUntil`, `weakenedUntil`, `corrodedUntil`, `frozenUntil`, `igniteUntil`, `attackCooldownUntil`, `screamCooldownUntil`, `trailCooldownUntil`, `leapCooldownUntil`, `specialCooldownUntil`, `specialTelegraphUntil`, `hivemindBuffUntil`, `staggerUntil`, `dieStartedAt`, `popStartedAt`, `burstUntil`, `explodeStartedAt`, `nextAddSummonAt`) and every hazard-zone/director timestamp (`expiresAt`, `nextTickAt`, `nextHordeEventAt`, `nextTitanCheckAt`, `nextMoanAt`, `nextFireSpreadCheckAt`) is currently an absolute `performance.now()`-based value. Broadcasting these raw would be meaningless to a different client, whose `performance.now()` origin is different. Every task that serializes one of these fields converts it to a **remaining-duration-in-ms** value at export time (`value - performance.now()`, clamped to 0 minimum) and converts it back to an absolute `performance.now()`-based value at import time (`performance.now() + remainingMs`) using the *importing* client's own clock.
- Transient FX-only state (in-flight grenade/molotov/knife/EMP throws, explosion/scream FX, fire/smoke zone visuals) is explicitly out of scope for migration - these are cosmetic and momentary; losing an in-flight thrown object's exact arc on a rare host handoff is an acceptable, deliberate simplification, not a bug.
- `this._multiplayerUid` (not `_multiplayerPlayerId` or similar) is this project's actual field name for "my own player id" - set in `_createMultiplayerSession`/`_joinMultiplayerSession` in `Game.js`. Use this exact name; don't invent a new one.
- Follow this project's Playwright gotchas (documented in its own `CLAUDE.md`): alternate touching every open page during any multi-second wait (background-tab throttling), force-hide `#asset-loader` after construction rather than waiting out its warmup, poll for `window.__game` rather than `waitForFunction`, and kill stray Chromium processes between test batches.

---

### Task 1: Baseline 3-player verification (no code changes expected)

**Files:**
- None expected - this task exists to empirically confirm the spec's own research finding ("already N-player-safe") before building migration on top of it, and to catch anything that finding missed.

**Interfaces:**
- N/A (verification only).

- [ ] **Step 1: Deploy the current code as-is**

```bash
npx vercel --prod --yes
```

- [ ] **Step 2: Run a 3-browser Playwright verification**

```python
from playwright.sync_api import sync_playwright
import time

def poll_all(check_fn, pages, timeout=60, interval=0.5):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        for pg in pages:
            pg.evaluate("() => true")
        result = check_fn()
        if result:
            return result
        time.sleep(interval)
    return result

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    guest1_page = browser.new_page()
    guest2_page = browser.new_page()
    pages = [host_page, guest1_page, guest2_page]

    host_page.goto('https://gayz.vercel.app', timeout=60000)
    deadline = time.time() + 60
    while time.time() < deadline and not host_page.evaluate("() => !!window.__game"):
        time.sleep(0.3)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    session_id = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'Host'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session:", session_id)

    for i, gp in enumerate((guest1_page, guest2_page), start=1):
        gp.goto(f'https://gayz.vercel.app/?join={session_id}', timeout=60000)
        deadline = time.time() + 60
        while time.time() < deadline and not gp.evaluate("() => !!window.__game"):
            time.sleep(0.3)
        gp.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
        gp.evaluate(f"""async () => {{
            window.__game.settings.nickname = 'Guest{i}'
            await window.__game._joinMultiplayerSession('{session_id}')
        }}""")

    for pg in pages:
        pg.evaluate("""() => {
            window.__game.gameStarted = true
            window.__game.player.controls.isLocked = true
            window.__game.playerState.alive = true
        }""")

    # Each guest should eventually see BOTH other players (host + the other guest).
    guest1_sees_2 = poll_all(lambda: guest1_page.evaluate("() => window.__game._otherPlayerPositions.length") == 2, pages, timeout=30)
    guest2_sees_2 = poll_all(lambda: guest2_page.evaluate("() => window.__game._otherPlayerPositions.length") == 2, pages, timeout=30)
    host_sees_2 = poll_all(lambda: host_page.evaluate("() => window.__game._otherPlayerPositions.length") == 2, pages, timeout=30)
    print("PASS - host sees both guests:", host_sees_2)
    print("PASS - guest1 sees host+guest2:", guest1_sees_2)
    print("PASS - guest2 sees host+guest1:", guest2_sees_2)

    # A zombie kill by the SECOND guest (not the first) should still credit only that guest.
    host_page.evaluate("() => window.__game.zombies._spawnRandom()")
    zid = None
    for _ in range(40):
        zid = host_page.evaluate("() => window.__game.zombies.zombies.find((z) => z.state === 'alive')?.id")
        if zid is not None:
            break
        host_page.evaluate("() => window.__game.zombies._spawnRandom()")

    other_ids = host_page.evaluate("() => window.__game._otherPlayerPositions.map((p) => p.playerId)")
    print("host sees these other player ids:", other_ids)
    guest2_uid = guest2_page.evaluate("() => window.__game._multiplayerUid")
    print("guest2's own uid:", guest2_uid, "| present in host's other-ids:", guest2_uid in other_ids)

    guest2_coins_before = guest2_page.evaluate("() => window.__game.coins")
    guest1_coins_before = guest1_page.evaluate("() => window.__game.coins")
    host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {zid})
        z.onHit(9999, {{ fromPlayerId: '{guest2_uid}' }})
    }}""")
    guest2_credited = poll_all(lambda: guest2_page.evaluate("() => window.__game.coins") != guest2_coins_before, pages, timeout=30)
    guest1_untouched = guest1_page.evaluate("() => window.__game.coins") == guest1_coins_before
    print("PASS - guest2 (not guest1) got credited for its own kill:", guest2_credited and guest1_untouched)

    browser.close()
```

Expected: all `PASS` lines print `True`. If any fail, investigate and fix the real bug in the relevant N-player-shaped code (`_renderRemotePlayers`, the multi-target zombie AI, or the credit-resolution logic) before proceeding - do not carry a known 3-player bug into the migration work.

- [ ] **Step 3: No commit needed if nothing broke** - if Step 2 uncovers a real bug, fix it, build-check (`npx vite build`), and commit that fix with a message describing the actual 3-player bug found, before moving to Task 2.

---

### Task 2: Expose each player's own join time and the current host's id

**Files:**
- Modify: `api/multiplayer/create.js`
- Modify: `api/multiplayer/join.js`
- Modify: `api/multiplayer/sync.js`
- Modify: `src/game/Multiplayer.js`
- Modify: `src/game/Game.js`

**Interfaces:**
- Produces: `this._myJoinedAt` (a client-side field, this player's own server-recorded join timestamp) and a `host` field in every sync response (the session's current host player id, available to every client including guests) - Task 10 (host-absence detection) and Task 11 (election) both consume these.

- [ ] **Step 1: Read `create.js`/`join.js` fresh and add `joinedAt` to their responses**

Find in `api/multiplayer/create.js`:

```js
  res.status(200).json({ sessionId, playerId })
```

Replace with:

```js
  res.status(200).json({ sessionId, playerId, joinedAt: now })
```

Find in `api/multiplayer/join.js`:

```js
  const playerId = randomUUID()
  await sessionRef.child(`players/${playerId}`).set({ nickname, joinedAt: Date.now() })

  res.status(200).json({ playerId })
```

Replace with:

```js
  const playerId = randomUUID()
  const joinedAt = Date.now()
  await sessionRef.child(`players/${playerId}`).set({ nickname, joinedAt })

  res.status(200).json({ playerId, joinedAt })
```

- [ ] **Step 2: Add `host` to `sync.js`'s response**

Read the file fresh to confirm the current exact shape before editing (it has been modified in every prior phase this session).

Find:

```js
  const hostSnapshot = await sessionRef.child('host').once('value')
  const isHost = hostSnapshot.val() === playerId
```

Replace with:

```js
  const hostSnapshot = await sessionRef.child('host').once('value')
  const currentHostId = hostSnapshot.val()
  const isHost = currentHostId === playerId
```

Find the final response object (near the end of the file):

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions, killEvents: killEventsOut,
    xpGems: xpGemsSnapshot.val() || {},
  })
```

Replace with:

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions, killEvents: killEventsOut,
    xpGems: xpGemsSnapshot.val() || {}, host: currentHostId,
  })
```

- [ ] **Step 3: Thread it through `Multiplayer.js`**

Find:

```js
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
```

Replace with:

```js
export async function createSession(nickname) {
  const { sessionId, playerId, joinedAt } = await _apiCall('create', { nickname })
  _playerIdFor.set(sessionId, playerId)
  return { sessionId, uid: playerId, joinedAt }
}

export async function joinSession(sessionId, nickname) {
  const { playerId, joinedAt } = await _apiCall('join', { sessionId, nickname })
  _playerIdFor.set(sessionId, playerId)
  return { uid: playerId, joinedAt }
}
```

Find:

```js
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
    killEvents: killEvents || [], xpGems: xpGems || {},
  }
```

Replace with:

```js
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems, host } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
    killEvents: killEvents || [], xpGems: xpGems || {}, host: host || null,
  }
```

- [ ] **Step 4: Store `_myJoinedAt` and the current `_hostPlayerId` in `Game.js`**

Find:

```js
  async _createMultiplayerSession() {
    this.multiplayerCreateDesc.textContent = t('multiplayerCreating')
    this.multiplayerCreateBtn.style.display = 'none'
    const Multiplayer = await import('./Multiplayer.js')
    const nickname = this.settings.nickname || 'Player'
    let sessionId, uid
    try {
      ({ sessionId, uid } = await Multiplayer.createSession(nickname))
    } catch {
      this.multiplayerCreateDesc.textContent = t('multiplayerCreateFailed')
      this.multiplayerCreateBtn.style.display = 'block'
      return
    }
    this._multiplayerSessionId = sessionId
    this._multiplayerUid = uid
    this._multiplayerIsHost = true
```

Replace with:

```js
  async _createMultiplayerSession() {
    this.multiplayerCreateDesc.textContent = t('multiplayerCreating')
    this.multiplayerCreateBtn.style.display = 'none'
    const Multiplayer = await import('./Multiplayer.js')
    const nickname = this.settings.nickname || 'Player'
    let sessionId, uid, joinedAt
    try {
      ({ sessionId, uid, joinedAt } = await Multiplayer.createSession(nickname))
    } catch {
      this.multiplayerCreateDesc.textContent = t('multiplayerCreateFailed')
      this.multiplayerCreateBtn.style.display = 'block'
      return
    }
    this._multiplayerSessionId = sessionId
    this._multiplayerUid = uid
    // Phase 6 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md) -
    // this player's own server-recorded join time, needed to compare
    // against every OTHER player's joinedAt (_otherPlayerJoinedAt) when
    // deciding who becomes the new host if the current one disconnects.
    this._myJoinedAt = joinedAt
    this._multiplayerIsHost = true
    // The creator is always the initial host - known locally without
    // needing a sync round-trip first.
    this._hostPlayerId = uid
```

Find:

```js
  async _joinMultiplayerSession(sessionId) {
    const Multiplayer = await import('./Multiplayer.js')
    const nickname = this.settings.nickname || 'Player'
    try {
      const { uid } = await Multiplayer.joinSession(sessionId, nickname)
      this._multiplayerSessionId = sessionId
      this._multiplayerUid = uid
      this._multiplayerIsHost = false
    } catch {
      this._showHomepageToast(t('multiplayerJoinFailed'))
    }
  }
```

Replace with:

```js
  async _joinMultiplayerSession(sessionId) {
    const Multiplayer = await import('./Multiplayer.js')
    const nickname = this.settings.nickname || 'Player'
    try {
      const { uid, joinedAt } = await Multiplayer.joinSession(sessionId, nickname)
      this._multiplayerSessionId = sessionId
      this._multiplayerUid = uid
      this._myJoinedAt = joinedAt
      this._multiplayerIsHost = false
      // Not known yet - the very next sync call's `host` field fills this
      // in (see Task 10). Never left null for long in practice: sync
      // starts immediately once gameStarted flips true.
      this._hostPlayerId = null
    } catch {
      this._showHomepageToast(t('multiplayerJoinFailed'))
    }
  }
```

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add api/multiplayer/create.js api/multiplayer/join.js api/multiplayer/sync.js src/game/Multiplayer.js src/game/Game.js
git commit -m "Expose each player's own join time and the current host id (Phase 6)"
```

---

### Task 3: Zombie.js - export and restore full simulation state

**Files:**
- Modify: `src/game/Zombie.js`

**Interfaces:**
- Produces: `Zombie.prototype.exportFullState()` (returns a plain serializable object) and `Zombie.prototype.restoreFullState(data)` (applies it back onto `this`, converting durations back to real `performance.now()`-based timestamps using the CALLING client's own clock) - Task 8 (host sends) calls the former; Task 14 (handoff) calls the latter.

Read the entire current `Zombie.js` fresh before writing this task - it has been edited across every prior multiplayer phase tonight, and this task's correctness depends on the exact current field set, not a remembered one.

- [ ] **Step 1: Add the export/restore methods**

Find (the existing `onHit` method's start, confirmed via fresh read at line 2367):

```js
  onHit(damage, opts = {}) {
```

Add these two new methods directly above it:

```js
  // Phase 6 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md) -
  // everything needed for a migrated-in host to keep this zombie behaving
  // IDENTICALLY, not just visually similar - every player-facing state
  // machine field, status effect, and cooldown, beyond the thin
  // position/health/type already broadcast for rendering.
  //
  // Every *Until/*At field representing an UPCOMING event is exported as
  // a REMAINING DURATION IN MS, and every *Since/*StartedAt field
  // representing something that ALREADY happened is exported as an
  // ELAPSED DURATION IN MS - never the raw performance.now() value,
  // which is a per-tab-relative clock that means nothing on a different
  // browser (see this plan's own Global Constraints). restoreFullState
  // converts these back to real performance.now()-based timestamps using
  // the calling (i.e. newly-importing) client's own clock.
  //
  // Deliberately excluded: isPackAlpha/_congestion (recomputed fresh
  // every frame from neighboring zombies, never meaningful to carry
  // over), the brief hit-react knockback fields (hitReactX/Z/Magnitude/
  // StartedAt, _hitReactOffsetX/Z - HIT_REACT_DURATION_MS is 200ms, far
  // shorter than the ~2.5-3s a real host disconnect takes to detect, so
  // this has always already fully decayed by migration time), and every
  // LOS-raycasting scratch/cache field (_losCachedResult/_losCacheUntil/
  // _moveBox/_losRaycaster/_losOrigin/_losDir - safe to just recompute
  // fresh, carrying over a stale cached LOS result would be actively
  // wrong).
  exportFullState() {
    const now = performance.now()
    const remaining = (until) => (until ? Math.max(0, until - now) : 0)
    const elapsed = (since) => (since ? Math.max(0, now - since) : 0)
    return {
      // Tier/identity flags - not part of `type`, so a plain shared
      // zombie can't otherwise be told apart from an elite/golden/
      // wandering/carrier one.
      isWandering: !!this.isWandering,
      isGolden: !!this.isGolden,
      isCarrier: !!this.isCarrier,
      isAlpha: !!this.isAlpha,
      isBoss: !!this.isBoss,
      flankSide: this.flankSide ?? null,
      fleeing: !!this.fleeing,
      // Awareness/wander AI mode.
      aware: !!this.aware,
      awareSinceMs: elapsed(this.awareSince),
      wanderDirX: this.wanderDirX,
      wanderDirZ: this.wanderDirZ,
      wanderRetargetInMs: remaining(this.wanderRetargetAt),
      dormantSinceMs: elapsed(this.dormantSince),
      // Status effects with expiry.
      enragedInMs: remaining(this.enragedUntil),
      enragePhase: this.enragePhase,
      weakenedInMs: remaining(this.weakenedUntil),
      hivemindBuffInMs: remaining(this.hivemindBuffUntil),
      staggerInMs: remaining(this.staggerUntil),
      igniteInMs: remaining(this.igniteUntil),
      igniteDps: this.igniteDps ?? 0,
      corrodedInMs: remaining(this.corrodedUntil),
      frozenInMs: remaining(this.frozenUntil),
      isCrippled: !!this.isCrippled,
      legHitCount: this.legHitCount ?? 0,
      isBerserk: !!this.isBerserk,
      // Cooldowns.
      attackCooldownInMs: remaining(this.attackCooldownUntil),
      attackAnimInMs: remaining(this.attackAnimUntil),
      screamCooldownInMs: remaining(this.screamCooldownUntil),
      screamPulseInMs: remaining(this.screamPulseUntil),
      trailCooldownInMs: remaining(this.trailCooldownUntil),
      leapCooldownInMs: remaining(this.leapCooldownUntil),
      specialCooldownInMs: remaining(this.specialCooldownUntil),
      specialTelegraphInMs: remaining(this.specialTelegraphUntil),
      nextAddSummonInMs: remaining(this.nextAddSummonAt),
      // Shielded-type absorb pool.
      shieldHealth: this.shieldHealth,
      // Death/transition state.
      dieStartedMsAgo: elapsed(this.dieStartedAt),
      popStartedMsAgo: elapsed(this.popStartedAt),
      burstInMs: remaining(this.burstUntil),
      pendingExplosion: !!this.pendingExplosion,
      explodeStartedMsAgo: elapsed(this.explodeStartedAt),
      deathHandled: !!this.deathHandled,
      // Climbing (mid-arc obstacle traversal) - kept despite its short
      // 500ms duration (ZOMBIE_CLIMB_DURATION_MS), unlike hit-react above,
      // since this is real simulation state (not pure decoration): a
      // zombie mid-climb needs to actually finish its arc correctly, not
      // silently reset to standing on the ground mid-obstacle. In
      // practice, by the time migration completes the elapsed real time
      // will usually already exceed 500ms, so the new host's own
      // progress-based climb-completion check (elapsed/duration, clamped
      // to 1) naturally finishes the climb immediately - which is the
      // CORRECT seamless behavior, not a bug.
      isClimbing: !!this.isClimbing,
      climbStartX: this._climbStartX,
      climbStartZ: this._climbStartZ,
      climbPeakY: this._climbPeakY,
      climbTargetX: this._climbTargetX,
      climbTargetZ: this._climbTargetZ,
      climbStartedMsAgo: elapsed(this._climbStartedAt),
      // Combat bookkeeping.
      lastHitWeaponId: this.lastHitWeaponId ?? null,
      lastHitFromPlayerId: this._lastHitFromPlayerId ?? null,
    }
  }

  // The inverse of exportFullState() above - applies a previously-
  // exported snapshot onto this instance, converting every duration back
  // into a real performance.now()-based timestamp using THIS client's own
  // clock (the only correct way to do it - see exportFullState's comment).
  restoreFullState(data) {
    if (!data) return
    const now = performance.now()
    const inFuture = (ms) => (ms > 0 ? now + ms : 0)
    const inPast = (ms) => (ms > 0 ? now - ms : 0)
    this.isWandering = !!data.isWandering
    this.isGolden = !!data.isGolden
    this.isCarrier = !!data.isCarrier
    this.isAlpha = !!data.isAlpha
    this.isBoss = !!data.isBoss
    this.flankSide = data.flankSide ?? null
    this.fleeing = !!data.fleeing
    this.aware = !!data.aware
    this.awareSince = inPast(data.awareSinceMs)
    this.wanderDirX = data.wanderDirX
    this.wanderDirZ = data.wanderDirZ
    this.wanderRetargetAt = inFuture(data.wanderRetargetInMs)
    this.dormantSince = inPast(data.dormantSinceMs)
    this.enragedUntil = inFuture(data.enragedInMs)
    this.enragePhase = data.enragePhase ?? 0
    this.weakenedUntil = inFuture(data.weakenedInMs)
    this.hivemindBuffUntil = inFuture(data.hivemindBuffInMs)
    this.staggerUntil = inFuture(data.staggerInMs)
    this.igniteUntil = inFuture(data.igniteInMs)
    this.igniteDps = data.igniteDps ?? 0
    this.corrodedUntil = inFuture(data.corrodedInMs)
    this.frozenUntil = inFuture(data.frozenInMs)
    this.isCrippled = !!data.isCrippled
    this.legHitCount = data.legHitCount ?? 0
    this.isBerserk = !!data.isBerserk
    this.attackCooldownUntil = inFuture(data.attackCooldownInMs)
    this.attackAnimUntil = inFuture(data.attackAnimInMs)
    this.screamCooldownUntil = inFuture(data.screamCooldownInMs)
    this.screamPulseUntil = inFuture(data.screamPulseInMs)
    this.trailCooldownUntil = inFuture(data.trailCooldownInMs)
    this.leapCooldownUntil = inFuture(data.leapCooldownInMs)
    this.specialCooldownUntil = inFuture(data.specialCooldownInMs)
    this.specialTelegraphUntil = inFuture(data.specialTelegraphInMs)
    this.nextAddSummonAt = inFuture(data.nextAddSummonInMs)
    this.shieldHealth = data.shieldHealth ?? 0
    this.dieStartedAt = inPast(data.dieStartedMsAgo)
    this.popStartedAt = inPast(data.popStartedMsAgo)
    this.burstUntil = inFuture(data.burstInMs)
    this.pendingExplosion = !!data.pendingExplosion
    this.explodeStartedAt = inPast(data.explodeStartedMsAgo)
    this.deathHandled = !!data.deathHandled
    this.isClimbing = !!data.isClimbing
    this._climbStartX = data.climbStartX
    this._climbStartZ = data.climbStartZ
    this._climbPeakY = data.climbPeakY
    this._climbTargetX = data.climbTargetX
    this._climbTargetZ = data.climbTargetZ
    this._climbStartedAt = inPast(data.climbStartedMsAgo)
    this.lastHitWeaponId = data.lastHitWeaponId ?? null
    this._lastHitFromPlayerId = data.lastHitFromPlayerId ?? null
  }

```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Zombie.js
git commit -m "Add full simulation state export/restore to Zombie.js for host migration (Phase 6)"
```

---

### Task 4: ZombieManager.js - export and restore the spawn/wave director state

**Files:**
- Modify: `src/game/ZombieManager.js`

**Interfaces:**
- Consumes: nothing new (works from its own fields).
- Produces: `ZombieManager.prototype.exportDirectorState()` and `ZombieManager.prototype.restoreDirectorState(data)` - Task 8 (host sends) calls the former; Task 14 (handoff) calls the latter, **after** its own zombies have already been reconstructed (see the `wanderingHorde.members` note below - restoring it too early would have nothing to resolve zombie ids against).

Read the entire current `ZombieManager.js` fresh before writing this task.

- [ ] **Step 1: Add the export/restore methods**

Find (the existing `damageInRadius` method, confirmed via fresh read earlier in this plan's own research):

```js
  damageInRadius(x, z, radius, minDamage, maxDamage) {
```

Add these two new methods directly above it:

```js
  // Phase 6 multiplayer - "what the simulation is about to do next" -
  // spawn/wave timers and horde state, none of which is per-zombie (see
  // Zombie.js's own exportFullState for that half). Same duration-not-
  // timestamp conversion discipline as Zombie.js - see this plan's Global
  // Constraints.
  //
  // wanderingHorde.members holds live Zombie object REFERENCES, which
  // can't be serialized directly (circular structure, THREE.js objects
  // inside) - exported as an array of zombie ids instead. This is why
  // restoreDirectorState (below) must be called AFTER the new host's own
  // zombies have already been reconstructed from the full-state broadcast
  // (see Task 14) - resolving those ids back into real references needs
  // them to already exist.
  exportDirectorState() {
    const now = performance.now()
    const remaining = (until) => (until ? Math.max(0, until - now) : 0)
    return {
      targetCount: this.targetCount,
      baseTargetCount: this.baseTargetCount,
      respawnDelay: this.respawnDelay,
      ambushChance: this.ambushChance,
      spawnRateMult: this.spawnRateMult,
      healthMult: this.healthMult,
      speedMult: this.speedMult,
      eliteChanceMult: this.eliteChanceMult,
      roundHealthMult: this.roundHealthMult,
      directorMult: this.directorMult,
      currentNight: this.currentNight,
      bossSpawnedForNight: this.bossSpawnedForNight,
      bossRushMode: !!this.bossRushMode,
      bossRushSpawnCount: this.bossRushSpawnCount,
      hordeMode: !!this.hordeMode,
      roundMode: !!this.roundMode,
      currentZone: this.currentZone ?? null,
      nextHordeEventInMs: remaining(this.nextHordeEventAt),
      hordeHushed: !!this._hordeHushed,
      titanAlive: !!this.titanAlive,
      nextTitanCheckInMs: remaining(this.nextTitanCheckAt),
      nextMoanInMs: remaining(this.nextMoanAt),
      nextFireSpreadCheckInMs: remaining(this.nextFireSpreadCheckAt),
      aggroRadiusMult: this.aggroRadiusMult,
      invisibleInMs: remaining(this.invisibleUntil),
      featuredEnemyId: this.featuredEnemyId ?? null,
      wanderingHorde: this.wanderingHorde
        ? {
            memberIds: this.wanderingHorde.members.map((z) => z.id),
            x: this.wanderingHorde.x,
            z: this.wanderingHorde.z,
            targetX: this.wanderingHorde.targetX,
            targetZ: this.wanderingHorde.targetZ,
            size: this.wanderingHorde.size,
            pendingSpawns: this.wanderingHorde.pendingSpawns,
          }
        : null,
    }
  }

  // The inverse of exportDirectorState() above. Call this ONLY after
  // this.zombies has already been repopulated with the migrated-in
  // host's own reconstructed Zombie instances (see this method's own
  // wanderingHorde handling, and Task 14's ordering).
  restoreDirectorState(data) {
    if (!data) return
    const now = performance.now()
    const inFuture = (ms) => (ms > 0 ? now + ms : 0)
    this.targetCount = data.targetCount
    this.baseTargetCount = data.baseTargetCount
    this.respawnDelay = data.respawnDelay
    this.ambushChance = data.ambushChance
    this.spawnRateMult = data.spawnRateMult
    this.healthMult = data.healthMult
    this.speedMult = data.speedMult
    this.eliteChanceMult = data.eliteChanceMult
    this.roundHealthMult = data.roundHealthMult
    this.directorMult = data.directorMult
    this.currentNight = data.currentNight
    this.bossSpawnedForNight = data.bossSpawnedForNight
    this.bossRushMode = !!data.bossRushMode
    this.bossRushSpawnCount = data.bossRushSpawnCount
    this.hordeMode = !!data.hordeMode
    this.roundMode = !!data.roundMode
    this.currentZone = data.currentZone ?? null
    this.nextHordeEventAt = inFuture(data.nextHordeEventInMs)
    this._hordeHushed = !!data.hordeHushed
    this.titanAlive = !!data.titanAlive
    this.nextTitanCheckAt = inFuture(data.nextTitanCheckInMs)
    this.nextMoanAt = inFuture(data.nextMoanInMs)
    this.nextFireSpreadCheckAt = inFuture(data.nextFireSpreadCheckInMs)
    this.aggroRadiusMult = data.aggroRadiusMult
    this.invisibleUntil = inFuture(data.invisibleInMs)
    this.featuredEnemyId = data.featuredEnemyId ?? null
    if (data.wanderingHorde) {
      const idSet = new Set(data.wanderingHorde.memberIds)
      this.wanderingHorde = {
        members: this.zombies.filter((z) => idSet.has(z.id)),
        x: data.wanderingHorde.x,
        z: data.wanderingHorde.z,
        targetX: data.wanderingHorde.targetX,
        targetZ: data.wanderingHorde.targetZ,
        size: data.wanderingHorde.size,
        pendingSpawns: data.wanderingHorde.pendingSpawns,
      }
    } else {
      this.wanderingHorde = null
    }
  }

```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/ZombieManager.js
git commit -m "Add spawn/wave director state export/restore to ZombieManager for host migration (Phase 6)"
```

---

### Task 5: Confirm hazard zones need no migration changes (verification only)

**Files:**
- None expected.

**Interfaces:**
- N/A.

Fresh reading of `Game.js` for this plan found `_updateHazardZones` is called unconditionally every frame (no host/guest gating anywhere in its call chain), and `_spawnHazardZone` is called both by the host (when a hazard-causing kill happens) AND by every guest independently (in the `worldEvents` replay loop, `else this._spawnHazardZone(ev.type, ev.x, ev.z)`) whenever the one-shot spawn event is broadcast. This means **every player already maintains their own fully-independent, locally-evolving copy** of `hazardZones` (with real `radius`/`expiresAt`/`nextTickAt`), built from the same shared spawn event and then ticked forward on each client's own clock ever since - unlike zombies/pickups, there is no host-authoritative hazard zone state to lose on migration, because there never was any single authoritative copy to begin with. A newly-elected host's own `hazardZones` array is already correct and already running - nothing needs to be broadcast, exported, or restored for this system.

- [ ] **Step 1: Confirm this empirically**

Read `Game.js`'s full call chain from `_tick()` down to `_updateHazardZones` and `_spawnHazardZone` fresh, and confirm no host/guest branch wraps either of them. If a branch is found that this research missed, treat this as a real, newly-discovered gap and add the equivalent broadcast/export/restore treatment Task 3/4 gave zombies/the director (remaining duration for `expiresAt`/`nextTickAt`, current `radius`) before proceeding - do not silently skip it.

- [ ] **Step 2: No commit needed** - this task makes no code changes if the confirmation in Step 1 holds.

---

### Task 6: api/multiplayer/sync.js - broadcast the expanded zombie state and the director block

**Files:**
- Modify: `api/multiplayer/sync.js`

**Interfaces:**
- Consumes: each zombie entry in the host's `zombies` payload gains an optional `full` field (Task 8 populates it via `Zombie.prototype.exportFullState()`); the host's payload gains an optional `director` field (Task 8 populates it via `ZombieManager.prototype.exportDirectorState()`).
- Produces: `zombiesById[key].full` and a `director` field in the sync response - Task 9 (guest retains the full snapshot) and Task 14 (handoff) both consume these.

Read the file fresh before editing (it was just modified in Task 2).

- [ ] **Step 1: Pass the full per-zombie state through**

Find:

```js
  if (isHost && Array.isArray(zombies)) {
    const zombiesById = {}
    for (const zb of zombies) {
      // Firebase RTDB gotcha: an object whose keys are ALL small sequential
      // numeric strings ("0", "1", "2"...) gets silently stored/returned as
      // a JSON ARRAY instead of a real object - and any gap in that
      // sequence (a zombie id that never became a shared type, which is
      // most of them in real play) comes back as a literal `null` entry,
      // which then throws the instant client code reads `.type` off it.
      // Zombie ids are a plain incrementing counter (Zombie.js's
      // zombieIdCounter), so this gap is the normal case, not an edge
      // case - prefixing the key with a letter keeps this a real object no
      // matter how sparse the id range is. See Game.js's
      // _renderSharedZombies for the matching read-side fix.
      zombiesById['z' + zb.id] = {
        x: zb.x, z: zb.z, rotY: zb.rotY, health: zb.health,
        maxHealth: zb.maxHealth, state: zb.state, type: zb.type,
        // Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md) -
        // drives a guest-side cosmetic throat-glow pulse for the screamer
        // type only; harmless/ignored for every other type.
        screaming: !!zb.screaming, updatedAt: now,
      }
    }
    await sessionRef.child('world/zombies').set(zombiesById)
  }
```

Replace with:

```js
  if (isHost && Array.isArray(zombies)) {
    const zombiesById = {}
    for (const zb of zombies) {
      // Firebase RTDB gotcha: an object whose keys are ALL small sequential
      // numeric strings ("0", "1", "2"...) gets silently stored/returned as
      // a JSON ARRAY instead of a real object - and any gap in that
      // sequence (a zombie id that never became a shared type, which is
      // most of them in real play) comes back as a literal `null` entry,
      // which then throws the instant client code reads `.type` off it.
      // Zombie ids are a plain incrementing counter (Zombie.js's
      // zombieIdCounter), so this gap is the normal case, not an edge
      // case - prefixing the key with a letter keeps this a real object no
      // matter how sparse the id range is. See Game.js's
      // _renderSharedZombies for the matching read-side fix.
      zombiesById['z' + zb.id] = {
        x: zb.x, z: zb.z, rotY: zb.rotY, health: zb.health,
        maxHealth: zb.maxHealth, state: zb.state, type: zb.type,
        // Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md) -
        // drives a guest-side cosmetic throat-glow pulse for the screamer
        // type only; harmless/ignored for every other type.
        screaming: !!zb.screaming, updatedAt: now,
        // Phase 6 multiplayer - the full non-rendering simulation state
        // (see Zombie.js's exportFullState), passed straight through
        // unmodified - this server never needs to understand its shape,
        // just carry it. Every player, not just an eventual new host,
        // receives it, so whoever ends up elected is always already warm.
        full: zb.full || null,
      }
    }
    await sessionRef.child('world/zombies').set(zombiesById)
  }
```

- [ ] **Step 2: Store and broadcast the director block**

Find:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems } = req.body || {}
```

Replace with:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems, director } = req.body || {}
```

Find:

```js
  if (isHost && Array.isArray(xpGems)) {
    const gemsById = {}
    for (const g of xpGems) {
      // Same sparse-array precaution as pickups above - gem ids are also
      // a plain incrementing counter.
      gemsById['g' + g.id] = { value: g.value, x: g.x, z: g.z }
    }
    await sessionRef.child('world/xpGems').set(gemsById)
  }
```

Replace with:

```js
  if (isHost && Array.isArray(xpGems)) {
    const gemsById = {}
    for (const g of xpGems) {
      // Same sparse-array precaution as pickups above - gem ids are also
      // a plain incrementing counter.
      gemsById['g' + g.id] = { value: g.value, x: g.x, z: g.z }
    }
    await sessionRef.child('world/xpGems').set(gemsById)
  }

  if (isHost && director) {
    // Phase 6 multiplayer - ZombieManager's own spawn/wave state (see
    // exportDirectorState). A plain object, not an array - no sparse-key
    // gotcha to worry about here.
    await sessionRef.child('world/director').set(director)
  }
```

- [ ] **Step 3: Read it back and include it in the response**

Find:

```js
  const [stateSnapshot, playersSnapshot, zombiesSnapshot, eventsSnapshot, pickupsSnapshot, chestsSnapshot, vaultOpenedSnapshot, windowsSnapshot, xpGemsSnapshot] = await Promise.all([
    sessionRef.child('playerState').once('value'),
    sessionRef.child('players').once('value'),
    sessionRef.child('world/zombies').once('value'),
    sessionRef.child('world/events').once('value'),
    sessionRef.child('world/pickups').once('value'),
    sessionRef.child('world/chests').once('value'),
    sessionRef.child('world/vaultOpened').once('value'),
    sessionRef.child('world/windows').once('value'),
    sessionRef.child('world/xpGems').once('value'),
  ])
```

Replace with:

```js
  const [stateSnapshot, playersSnapshot, zombiesSnapshot, eventsSnapshot, pickupsSnapshot, chestsSnapshot, vaultOpenedSnapshot, windowsSnapshot, xpGemsSnapshot, directorSnapshot] = await Promise.all([
    sessionRef.child('playerState').once('value'),
    sessionRef.child('players').once('value'),
    sessionRef.child('world/zombies').once('value'),
    sessionRef.child('world/events').once('value'),
    sessionRef.child('world/pickups').once('value'),
    sessionRef.child('world/chests').once('value'),
    sessionRef.child('world/vaultOpened').once('value'),
    sessionRef.child('world/windows').once('value'),
    sessionRef.child('world/xpGems').once('value'),
    sessionRef.child('world/director').once('value'),
  ])
```

Find:

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions, killEvents: killEventsOut,
    xpGems: xpGemsSnapshot.val() || {}, host: currentHostId,
  })
```

Replace with:

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions, killEvents: killEventsOut,
    xpGems: xpGemsSnapshot.val() || {}, host: currentHostId, director: directorSnapshot.val() || null,
  })
```

- [ ] **Step 4: Commit**

```bash
git add api/multiplayer/sync.js
git commit -m "Broadcast full zombie simulation state and the spawn director block (Phase 6)"
```

---

### Task 7: src/game/Multiplayer.js - thread `director` through the sync return shape

**Files:**
- Modify: `src/game/Multiplayer.js`

**Interfaces:**
- Produces: `syncPlayerState(...)`'s resolved object gains `director` - Task 8/9 consume it.

Task 2 already added `host` to this same function's destructure/return - this task adds `director` on top of that. Read the file fresh to confirm its exact current shape before editing.

- [ ] **Step 1: Add `director`**

Find:

```js
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems, host } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
    killEvents: killEvents || [], xpGems: xpGems || {}, host: host || null,
  }
```

Replace with:

```js
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems, host, director } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
    killEvents: killEvents || [], xpGems: xpGems || {}, host: host || null, director: director || null,
  }
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Multiplayer.js
git commit -m "Thread the director block through Multiplayer.js's sync return shape (Phase 6)"
```

---

### Task 8: Game.js host-side - send the expanded zombie state and director block every sync

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `Zombie.prototype.exportFullState()` (Task 3), `ZombieManager.prototype.exportDirectorState()` (Task 4).
- Produces: `payload.zombies[].full` and `payload.director` sent on every host sync tick.

- [ ] **Step 1: Add `full` to each zombie's payload and send the director block**

Find (confirmed via fresh read at line 15699-15706):

```js
    if (this._multiplayerIsHost) {
      payload.zombies = this.zombies.zombies
        .filter((z) => SHARED_ZOMBIE_TYPE_IDS.has(z.type) && z.state !== 'dead')
        .map((z) => ({
          id: z.id, x: z.group.position.x, z: z.group.position.z, rotY: z.group.rotation.y,
          health: z.health, maxHealth: z.maxHealth, state: z.state, type: z.type,
          screaming: performance.now() < z.screamPulseUntil,
        }))
```

Replace with:

```js
    if (this._multiplayerIsHost) {
      payload.zombies = this.zombies.zombies
        .filter((z) => SHARED_ZOMBIE_TYPE_IDS.has(z.type) && z.state !== 'dead')
        .map((z) => ({
          id: z.id, x: z.group.position.x, z: z.group.position.z, rotY: z.group.rotation.y,
          health: z.health, maxHealth: z.maxHealth, state: z.state, type: z.type,
          screaming: performance.now() < z.screamPulseUntil,
          // Phase 6 multiplayer - every player receives this (not just an
          // eventual new host), so whoever gets elected is always already
          // warm with near-real-time full state - see Task 9.
          full: z.exportFullState(),
        }))
      // Phase 6 multiplayer - the spawn/wave director's own state, sent
      // alongside the zombies themselves for the same "always warm" reason.
      payload.director = this.zombies.exportDirectorState()
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "Send full zombie simulation state and the director block on every host sync (Phase 6)"
```

---

### Task 9: Game.js guest-side - retain the full snapshot on every shared zombie, and the director block on `this`

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `zombie.restoreFullState` is NOT called here (that only happens on actual takeover, Task 14) - this task only STORES the raw data for later use.
- Produces: every `Zombie` instance in `this._sharedZombieBodies` gains a `_lastFullState` field (the raw `state.full` object, refreshed every render call); `this._lastDirectorSnapshot` holds the latest received `director` block. Task 14 reads both.

- [ ] **Step 1: Stash the full state on each shared zombie**

Find (confirmed via fresh read at line 15879-15902, `_renderSharedZombies`'s body):

```js
      zombie.applyNetworkState(state.x, state.z, state.rotY, state.health, state.maxHealth, state.state, localPlayerX, localPlayerZ, !!state.screaming)
    }
    for (const [id, zombie] of this._sharedZombieBodies) {
```

Replace with:

```js
      zombie.applyNetworkState(state.x, state.z, state.rotY, state.health, state.maxHealth, state.state, localPlayerX, localPlayerZ, !!state.screaming)
      // Phase 6 multiplayer - kept "warm" on every sync so this zombie can
      // be upgraded in place into a real, fully-simulated instance with
      // zero visual reset if THIS client is ever elected the new host
      // (see Task 14). Never read for rendering purposes - only takeover.
      zombie._lastFullState = state.full || null
    }
    for (const [id, zombie] of this._sharedZombieBodies) {
```

- [ ] **Step 2: Stash the director block on `this`**

Find:

```js
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems }) => {
```

Replace with:

```js
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems, host, director }) => {
        // Phase 6 multiplayer - kept warm the same way per-zombie full
        // state is (Step 1 above), for the same reason - see Task 14.
        this._lastDirectorSnapshot = director
```

This edit intentionally leaves the rest of the `.then(...)` callback body untouched below it - `host` is consumed starting in Task 10, not here.

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "Keep every shared zombie and the director block warm for a potential host takeover (Phase 6)"
```

---

### Task 10: Host-absence detection

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `host` field from the sync response (Task 7/9), `this._hostPlayerId` (Task 2).
- Produces: `this._hostMissingStreak` (a counter) and a call to a new `_onHostConfirmedGone()` method (stubbed as a no-op call site here; Task 11 gives it a real body) once the host has been absent for 2 consecutive syncs.

- [ ] **Step 1: Track the current host id and detect its absence**

Find (this is the exact same `.then(...)` callback Task 9 Step 2 just edited - find it fresh after that edit, since Task 9 added `this._lastDirectorSnapshot = director` right after the opening of this callback):

```js
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems, host, director }) => {
        // Phase 6 multiplayer - kept warm the same way per-zombie full
        // state is (Step 1 above), for the same reason - see Task 14.
        this._lastDirectorSnapshot = director
        this._renderRemotePlayers(states)
```

(The line `this._renderRemotePlayers(states)` immediately follows what Task 9 added - confirm this via a fresh read, since exact adjacency matters for this Find block to match.)

Replace with:

```js
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems, host, director }) => {
        // Phase 6 multiplayer - kept warm the same way per-zombie full
        // state is (Step 1 above), for the same reason - see Task 14.
        this._lastDirectorSnapshot = director
        // Phase 6 multiplayer - host-absence detection. Only a GUEST ever
        // needs to watch for this (the host already knows it's the host).
        // `host` (the session's STORED host field) is basically always
        // present - it doesn't tell you whether that player is actually
        // still active. `states` is the real signal: it's already
        // filtered server-side to exclude anyone who's gone stale (see
        // sync.js's STALE_MS), so checking whether the host's id appears
        // as a key in `states` is what actually detects "the host looks
        // gone," not the mere presence/absence of the `host` field itself.
        if (!this._multiplayerIsHost && host) {
          if (host !== this._hostPlayerId) {
            // The host id changed since this client last knew - either
            // this is its very first sync (learning who's host for the
            // first time) or a migration already completed (possibly
            // claimed by a different client than this one). Either way,
            // just adopt it - no action needed from this client.
            this._hostPlayerId = host
            this._hostMissingStreak = 0
          } else if (host !== this._multiplayerUid && !(host in states)) {
            // The player who's SUPPOSED to be host isn't among the
            // currently-active other players this sync call returned.
            this._hostMissingStreak = (this._hostMissingStreak || 0) + 1
            if (this._hostMissingStreak >= 2) {
              this._hostMissingStreak = 0
              this._onHostConfirmedGone()
            }
          } else {
            this._hostMissingStreak = 0
          }
        }
        this._renderRemotePlayers(states)
```

- [ ] **Step 2: Add a stub for `_onHostConfirmedGone`**

Add this method near `_renderRemotePlayers` (Task 11 replaces the body with the real election logic - this stub exists only so Task 10 alone is buildable/testable):

```js
  // Phase 6 multiplayer - called once the host has been confirmed absent
  // across 2 consecutive syncs (see the detection logic above). Stub for
  // now - Task 11 gives this a real body (the election computation).
  _onHostConfirmedGone() {
    console.warn('Host appears to be gone - migration not yet implemented (Task 11)')
  }
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "Detect when the host has genuinely gone missing (Phase 6)"
```

---

### Task 11: Deterministic election

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `this._myJoinedAt` (Task 2), the `states` sync response.
- Produces: `_onHostConfirmedGone(states)` (real body, replacing Task 10's stub) and a new `_tryClaimHost()` method - calls `Multiplayer.claimHost` (Task 13's export) and, on success, `this._performHostTakeover(...)` (Task 14's method).

- [ ] **Step 1: Pass `states` into `_onHostConfirmedGone` at its call site**

Find (this is Task 10's own new code, inside the same `.then(...)` callback):

```js
            this._hostMissingStreak = (this._hostMissingStreak || 0) + 1
            if (this._hostMissingStreak >= 2) {
              this._hostMissingStreak = 0
              this._onHostConfirmedGone()
            }
```

Replace with:

```js
            this._hostMissingStreak = (this._hostMissingStreak || 0) + 1
            if (this._hostMissingStreak >= 2) {
              this._hostMissingStreak = 0
              this._onHostConfirmedGone(states)
            }
```

- [ ] **Step 2: Replace the stub with the real election + claim logic**

Find (Task 10's stub):

```js
  // Phase 6 multiplayer - called once the host has been confirmed absent
  // across 2 consecutive syncs (see the detection logic above). Stub for
  // now - Task 11 gives this a real body (the election computation).
  _onHostConfirmedGone() {
    console.warn('Host appears to be gone - migration not yet implemented (Task 11)')
  }
```

Replace with:

```js
  // Phase 6 multiplayer - called once the host has been confirmed absent
  // across 2 consecutive syncs. `states` is the SAME already-staleness-
  // filtered list of currently-active other players this sync call just
  // returned (see sync.js's own STALE_MS filtering) - by construction it
  // already excludes the departed host, so no extra filtering is needed
  // here beyond adding this client's own id/joinedAt to the pool.
  //
  // Every remaining client runs this exact same deterministic computation
  // from data every client already has (each player's own server-
  // recorded joinedAt), so every client independently arrives at the
  // SAME winner without any voting or coordination round-trip. If two
  // clients' views briefly disagree (e.g. one's last sync is a hair
  // staler than another's right at this exact moment), the claim
  // endpoint's own atomic transaction (Task 12) is the real tie-breaker -
  // only one claim can ever actually succeed, and a losing claimant here
  // just quietly waits to see the host id update on a future sync rather
  // than erroring.
  _onHostConfirmedGone(states) {
    const candidates = [{ id: this._multiplayerUid, joinedAt: this._myJoinedAt || 0 }]
    for (const [id, state] of Object.entries(states)) {
      candidates.push({ id, joinedAt: state.joinedAt || 0 })
    }
    candidates.sort((a, b) => a.joinedAt - b.joinedAt)
    if (candidates[0].id === this._multiplayerUid) {
      this._tryClaimHost()
    }
    // Not the winner - do nothing. This same method fires again in
    // another couple of sync ticks if the host is still missing by then
    // (see the detection logic), re-checking whether the winner's claim
    // has taken effect yet.
  }

  // Phase 6 multiplayer - attempts to actually become the new host.
  // Fire-and-forget from the caller's perspective (no return value
  // needed) - success is reflected by _multiplayerIsHost flipping true
  // and the takeover running; failure just leaves this client waiting,
  // same as any non-winning client.
  async _tryClaimHost() {
    const Multiplayer = await import('./Multiplayer.js')
    let result
    try {
      result = await Multiplayer.claimHost(this._multiplayerSessionId)
    } catch {
      return
    }
    if (result && result.ok) {
      this._performHostTakeover()
    }
    // A rejected claim (someone else's claim already won, or the "old"
    // host turned out not to actually be stale server-side) needs no
    // handling here - this client just keeps rendering as a guest, and
    // the next sync's host-absence detection naturally re-evaluates.
  }
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds (this task references `Multiplayer.claimHost` and `this._performHostTakeover`, neither of which exist yet - this is a forward reference to Tasks 13/14, harmless since nothing calls this method until a real disconnect happens, and `npx vite build` only checks syntax/bundling, not runtime behavior).

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "Add deterministic host election (Phase 6)"
```

---

### Task 12: New endpoint - api/multiplayer/claim-host.js

**Files:**
- Create: `api/multiplayer/claim-host.js`

**Interfaces:**
- Produces: `POST /api/multiplayer/claim-host {sessionId, playerId} -> {ok: true} | {ok: false, reason}` - Task 13's `Multiplayer.claimHost` wrapper calls this.

Read `api/multiplayer/sync.js` and `api/multiplayer/join.js` fresh first, to match this project's exact existing conventions (how `getAdminDb` is imported, the exact response-shape style, the exact `STALE_MS` value currently used).

- [ ] **Step 1: Write the endpoint**

Create `api/multiplayer/claim-host.js`:

```js
// POST { sessionId, playerId } -> { ok: true } | { ok: false, reason }
// Called by whichever remaining player's own client independently computed
// itself as the correct successor (see Game.js's _tryClaimHost/
// _onHostConfirmedGone, docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md)
// once the current host appears to have disconnected. Never trusts the
// claim blindly - independently re-verifies the CURRENT host is actually
// stale before granting it, and uses a transaction on the `host` field so
// two near-simultaneous claims from different clients can't both succeed.
// This is also what protects the "old host was just a brief network blip,
// not really gone" case: if the real host's own next update lands before a
// claim is granted, that claim is rejected here.
import { getAdminDb } from '../_lib/firebaseAdmin.js'

// Same value as api/multiplayer/sync.js's own STALE_MS - duplicated rather
// than imported across files for one shared constant (these are separate
// serverless functions, no shared module between them today).
const STALE_MS = 2500

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { sessionId, playerId } = req.body || {}
  if (!sessionId || !playerId) {
    return res.status(400).json({ error: 'sessionId and playerId are required' })
  }

  const db = getAdminDb()
  const sessionRef = db.ref(`multiplayerSessions/${sessionId}`)

  const hostSnapshot = await sessionRef.child('host').once('value')
  const currentHostId = hostSnapshot.val()
  if (!currentHostId) {
    return res.status(404).json({ error: 'Session not found' })
  }

  const now = Date.now()
  const hostStateSnapshot = await sessionRef.child(`playerState/${currentHostId}`).once('value')
  const hostState = hostStateSnapshot.val()
  const hostIsStale = !hostState || now - hostState.updatedAt > STALE_MS
  if (!hostIsStale) {
    return res.status(200).json({ ok: false, reason: 'host-still-active' })
  }

  // The claiming player needs to actually be a real, currently-active
  // member of this session too (not itself stale/departed) - same
  // staleness check, just against the claimant instead of the host. This
  // project's established trust model (Phase 3's own spec) doesn't need
  // this to independently re-derive "the exact correct election winner" -
  // a wrong-but-active claimant is a benign wrong-host choice among
  // trusted friends, not a security problem.
  const claimantStateSnapshot = await sessionRef.child(`playerState/${playerId}`).once('value')
  const claimantState = claimantStateSnapshot.val()
  if (!claimantState || now - claimantState.updatedAt > STALE_MS) {
    return res.status(200).json({ ok: false, reason: 'claimant-not-active' })
  }

  const txResult = await sessionRef.child('host').transaction((current) => {
    // Abort if someone else's claim already won between the read above
    // and this transaction actually running - the standard optimistic-
    // concurrency guard, and the real tie-breaker if two clients' own
    // election computations briefly disagreed.
    if (current !== currentHostId) return undefined
    return playerId
  })

  if (!txResult.committed) {
    return res.status(200).json({ ok: false, reason: 'lost-race' })
  }

  res.status(200).json({ ok: true })
}
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds (this file isn't part of the Vite client bundle - Vercel serverless functions under `api/` aren't bundled by Vite - but running the build check confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add api/multiplayer/claim-host.js
git commit -m "Add the claim-host endpoint with a transactional staleness re-check (Phase 6)"
```

---

### Task 13: src/game/Multiplayer.js - add the `claimHost` wrapper

**Files:**
- Modify: `src/game/Multiplayer.js`

**Interfaces:**
- Produces: `claimHost(sessionId)` -> `Promise<{ok: boolean, reason?: string}>` - Task 11's `_tryClaimHost` calls this.

- [ ] **Step 1: Add the wrapper, matching every other function in this file's existing pattern**

Find (the end of the `leave` function, confirmed via fresh read earlier in this plan's own research):

```js
export async function leave(sessionId) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) return
  await _apiCall('leave', { sessionId, playerId })
  _playerIdFor.delete(sessionId)
}
```

Add this new function directly after it:

```js
// Phase 6 multiplayer - attempts to become the new host after the
// current one has been confirmed gone (see Game.js's _tryClaimHost). The
// server independently re-verifies before granting this - a rejected
// claim (ok: false) is a normal, expected outcome (lost a race, or the
// "old" host turned out to still be active), not an error.
export async function claimHost(sessionId) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  return await _apiCall('claim-host', { sessionId, playerId })
}
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Multiplayer.js
git commit -m "Add the claimHost wrapper to Multiplayer.js (Phase 6)"
```

---

### Task 14: The actual handoff

**Files:**
- Modify: `src/game/Zombie.js`
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `zombie.restoreFullState` (Task 3), `zombies.restoreDirectorState` (Task 4), `zombie._lastFullState`/`this._lastDirectorSnapshot` (Task 9), `this._tryClaimHost` calling `this._performHostTakeover()` (Task 11).
- Produces: `Zombie.bumpIdCounterPast(id)` (module-level export) and `Game.prototype._performHostTakeover()`.

Three things this task depends on were independently confirmed via fresh reads during this plan's own research, and are restated here since they shape what this task does and does NOT need to do:

1. **`this.zombies.zombies.update(...)` is already gated `if (!this._multiplayerSessionId || this._multiplayerIsHost)`** (confirmed at `src/game/Game.js:21386`) - simply flipping `_multiplayerIsHost` to `true` is enough to make the real per-frame zombie AI/spawn loop start running on this client on the very next frame. No separate "start the loop" call is needed.
2. **Chests/Vault/BarricadeWindows state is already applied directly onto each client's own local objects** (not a separate "shared" mirror the way zombies/pickups are) - confirmed via the existing sync-response-handling loop (`window.planks = state.planks`, applied to `this.barricadeWindows.windows[i]` itself). A migrated host's own chest/vault/window state is therefore already correct and needs no handling here.
3. **Hazard zones need no handling either** - confirmed in Task 5: every client, host or guest, already independently simulates its own `hazardZones` array from the same one-shot spawn event.

What DOES need explicit handling, beyond zombies/the director (Tasks 3/4/8/9 already built the export/restore/warm-storage plumbing for those): **pickups and XP gems**. Unlike chests/vault/windows, a guest's `sharedPickups`/`sharedGems` are a separate lightweight mirror (built by `_renderSharedPickups`/`_renderSharedGems`) - NOT applied onto the real `this.pickups.pickups`/`this.xpGems.gems` arrays a host actually broadcasts from. Without migrating these too, the instant this client becomes host it would broadcast its own (empty) real `pickups`/`gems` arrays, and every existing pickup/gem would visibly vanish for every player - a real, visible regression, not a subtle timing nuance. This task fixes that by moving each shared `Pickup`/`XpGem` object (id/type/position already fully known - nothing new to broadcast) into the real array, reusing the same mesh (no visual reset). The one deliberate simplification: each moved item's expire countdown (`spawnedAt`) is reset to "just spawned now" rather than preserving its exact remaining time - a purely cosmetic timing detail (an item might now last a few seconds longer than it originally would have) with no visible glitch, in the same spirit as this plan's other explicitly-noted simplifications (hit-react, in-flight FX).

- [ ] **Step 1: Add a zombie-id-counter bump export to `Zombie.js`**

A migrated-in host's own local `zombieIdCounter` (used to assign ids to any NEWLY spawned zombie from here on) has never been used for anything but locally-discarded ids while this client was a guest (every shared zombie's real id came from the id the HOST originally assigned, overwritten onto the local instance right after construction - see `_renderSharedZombies`). Left alone, a freshly-spawned zombie after takeover could easily collide with the id of an existing (just-migrated) zombie, corrupting every id-based lookup in the system. Fix: bump the counter past the highest id actually in use, once, right after taking over.

Find:

```js
let zombieIdCounter = 0
```

Replace with:

```js
let zombieIdCounter = 0

// Phase 6 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase6-scaling-migration-design.md) -
// called once by a newly-migrated host (see Game.js's _performHostTakeover)
// so the NEXT freshly-spawned zombie's id can never collide with one it
// just inherited - this client's own zombieIdCounter has never tracked
// real in-use ids before now (every shared zombie's real id always came
// from the host, overwritten onto the local instance after construction).
export function bumpZombieIdCounterPast(maxKnownId) {
  if (maxKnownId >= zombieIdCounter) zombieIdCounter = maxKnownId + 1
}
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Zombie.js
git commit -m "Add a zombie id counter bump export for host takeover (Phase 6)"
```

- [ ] **Step 4: Import the new export in `Game.js`**

Find:

```js
import { XpGemManager, XpGem } from './XpGems.js'
```

Add this import near it (exact surrounding import lines may differ slightly - place it as its own line among the other `./Zombie.js` imports, which already exist elsewhere in this file's import block; grep for `from './Zombie.js'` to find the existing import statement and extend it rather than adding a second one):

```js
import { bumpZombieIdCounterPast } from './Zombie.js'
```

- [ ] **Step 5: Write `_performHostTakeover`**

Add this method near `_tryClaimHost` (Task 11):

```js
  // Phase 6 multiplayer - runs once, immediately after a successful
  // claim-host call (see _tryClaimHost). Upgrades everything this client
  // was passively rendering as a guest into the real, authoritative
  // simulation, reusing the same objects/meshes throughout so nothing
  // visually pops or resets.
  _performHostTakeover() {
    this._multiplayerIsHost = true
    this._hostPlayerId = this._multiplayerUid

    // --- Zombies ---
    let maxZombieId = -1
    for (const [id, zombie] of this._sharedZombieBodies) {
      if (id > maxZombieId) maxZombieId = id
      // The critical flag - onHit() checks this FIRST, before anything
      // else, to decide whether to redirect to _onNetworkHit (a guest's
      // report-only path) instead of applying real damage.
      zombie.isNetworkDriven = false
      zombie._onNetworkHit = null
      zombie.restoreFullState(zombie._lastFullState)
      this.zombies.zombies.push(zombie)
    }
    if (maxZombieId >= 0) bumpZombieIdCounterPast(maxZombieId)
    // These zombies now live for real in this.zombies.zombies - clear the
    // guest-only bookkeeping that tracked them as shared/network-driven,
    // so they're never double-counted (see ZombieManager's own
    // hittableMeshes getter, which concatenates both arrays).
    this.zombies.sharedZombies = []
    this._sharedZombieBodies.clear()

    // --- Spawn/wave director state - AFTER zombies above, since
    // restoreDirectorState needs to resolve wanderingHorde.members ids
    // against zombies that already exist in this.zombies.zombies. ---
    this.zombies.restoreDirectorState(this._lastDirectorSnapshot)

    // --- Pickups (ground loot) - see this task's own header comment for
    // why this needs explicit handling, unlike chests/vault/windows. ---
    for (const pickup of this.pickups.sharedPickups) {
      pickup.spawnedAt = performance.now()
      this.pickups.pickups.push(pickup)
    }
    this.pickups.sharedPickups = []
    this._collectedPickupIds.clear()

    // --- XP gems - same treatment as pickups above. ---
    for (const gem of this.xpGems.sharedGems) {
      gem.spawnedAt = performance.now()
      this.xpGems.gems.push(gem)
    }
    this.xpGems.sharedGems = []
    this._collectedGemIds.clear()

    // Chests/Vault/BarricadeWindows/hazard zones need nothing here - see
    // this task's own header comment for why (each already carries its
    // own correct state on every client, not just the host).

    this._showLoreToast(t('multiplayerBecameHost'))
  }
```

- [ ] **Step 6: Add the toast string**

Find (`src/game/i18n.js`'s English block - locate any existing `multiplayer*` key, e.g. `multiplayerJoinFailed`, to place this near its established neighbors):

```js
  multiplayerJoinFailed: 'Could not join that session.',
```

Add directly after it:

```js
  multiplayerBecameHost: 'The host disconnected - you\'re now hosting the world.',
```

(If the exact neighboring key text differs from what's shown above, add the new key adjacent to whichever `multiplayer*` keys already exist in that file's English block - exact placement among them doesn't matter, just keep it grouped with the others.)

- [ ] **Step 7: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/game/Game.js src/game/i18n.js
git commit -m "Build the actual host takeover - upgrade shared zombies/pickups/gems into real simulation state (Phase 6)"
```

---

### Task 15: Handle a demoted former host gracefully

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `host` from the sync response (Task 7/9).
- Produces: a new `_onDemotedFromHost()` method.

Covers the case where the "old" host wasn't really gone - just a long tab-freeze - and comes back to find someone else already migrated in while it was unresponsive. The server-side half of this needs no changes: `sync.js`'s `isHost` check (`currentHostId === playerId`) is already recomputed fresh on every single call by reading the CURRENT `host` field, so a demoted former host's world-state writes are already silently ignored the moment it tries to sync again (every `if (isHost && ...)` guard already in `sync.js` already covers this). What's missing is the CLIENT noticing this happened and stepping down instead of continuing to needlessly (though harmlessly) simulate a world nobody else sees.

- [ ] **Step 1: Detect it and step down**

Find (the mirror image of Task 10 Step 1's guest-side check - this one goes in the HOST branch of the same `.then(...)` callback; find the line where that branch starts, immediately after the guest-absence-detection block Task 10/11 added):

```js
        this._renderRemotePlayers(states)
        if (this._multiplayerIsHost) {
```

Replace with:

```js
        this._renderRemotePlayers(states)
        if (this._multiplayerIsHost && host && host !== this._multiplayerUid) {
          // Phase 6 multiplayer - this client still thinks it's host, but
          // the server disagrees (someone else has already been granted
          // the role - see api/multiplayer/claim-host.js). Every world-
          // state write this client just sent was silently ignored
          // server-side (sync.js's own isHost check already handles
          // that) - this is purely about THIS client noticing and
          // stepping down, not a security concern.
          this._onDemotedFromHost(host)
        } else if (this._multiplayerIsHost) {
```

This intentionally leaves the rest of that branch's existing body (`pendingHits` processing, `interactions` handling, etc.) untouched below it, and leaves the original `} else {` (the pre-existing guest branch further down, confirmed via fresh read) as the final `else` of what's now a 3-way `if`/`else if`/`else` chain.

- [ ] **Step 2: Write `_onDemotedFromHost`**

Add this method near `_performHostTakeover` (Task 14):

```js
  // Phase 6 multiplayer - this client was simulating the world as host,
  // but the server says someone else now holds that role (see this
  // method's own call site). Tears down this client's own now-orphaned
  // real zombies/pickups/gems (nobody else was ever seeing them anyway,
  // once migration completed) and switches to rendering the NEW host's
  // broadcast instead - the exact same guest-rendering path a client
  // that was always a guest already uses, so nothing extra is needed
  // beyond flipping the flag and clearing what this client used to own.
  _onDemotedFromHost(newHostId) {
    for (const zombie of this.zombies.zombies) {
      this.scene.remove(zombie.group)
      zombie.dispose()
    }
    this.zombies.zombies = []
    for (const pickup of this.pickups.pickups) this.scene.remove(pickup.group)
    this.pickups.pickups = []
    for (const gem of this.xpGems.gems) this.scene.remove(gem.mesh)
    this.xpGems.gems = []
    this._multiplayerIsHost = false
    this._hostPlayerId = newHostId
    this._showLoreToast(t('multiplayerDemoted'))
  }
```

- [ ] **Step 3: Add the toast string**

Find the same `multiplayerBecameHost` key Task 14 Step 6 just added:

```js
  multiplayerBecameHost: 'The host disconnected - you\'re now hosting the world.',
```

Add directly after it:

```js
  multiplayerDemoted: 'Reconnected - another player took over hosting while you were away.',
```

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js src/game/i18n.js
git commit -m "Handle a former host gracefully stepping down after being replaced (Phase 6)"
```

---

### Task 16: Deploy and verify

**Files:**
- None (deploy + verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-15.

- [ ] **Step 1: Deploy to production**

```bash
npx vercel --prod --yes
```

- [ ] **Step 2: Re-run Task 1's 3-player baseline test against the deployed build**

Confirms nothing regressed now that the full migration code is in place. Re-run the exact script from Task 1 Step 2 unmodified; all `PASS` lines must still print `True`.

- [ ] **Step 3: Host migration verification**

```python
from playwright.sync_api import sync_playwright
import time

def poll_pages(check_fn, pages, timeout=60, interval=0.5):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        for pg in pages:
            try:
                pg.evaluate("() => true")
            except Exception:
                pass  # a page we've deliberately closed mid-test
        result = check_fn()
        if result:
            return result
        time.sleep(interval)
    return result

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    guest1_page = browser.new_page()  # earliest-joined guest - should become the new host
    guest2_page = browser.new_page()

    host_page.goto('https://gayz.vercel.app', timeout=60000)
    deadline = time.time() + 60
    while time.time() < deadline and not host_page.evaluate("() => !!window.__game"):
        time.sleep(0.3)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    session_id = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'Host'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session:", session_id)

    for i, gp in enumerate((guest1_page, guest2_page), start=1):
        gp.goto(f'https://gayz.vercel.app/?join={session_id}', timeout=60000)
        deadline = time.time() + 60
        while time.time() < deadline and not gp.evaluate("() => !!window.__game"):
            time.sleep(0.3)
        gp.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
        gp.evaluate(f"""async () => {{
            window.__game.settings.nickname = 'Guest{i}'
            await window.__game._joinMultiplayerSession('{session_id}')
        }}""")
        time.sleep(1.5)  # stagger real join times so joinedAt ordering is unambiguous

    all_pages = [host_page, guest1_page, guest2_page]
    for pg in all_pages:
        pg.evaluate("""() => {
            window.__game.gameStarted = true
            window.__game.player.controls.isLocked = true
            window.__game.playerState.alive = true
        }""")

    # Let everyone see each other and let a few sync cycles pass.
    poll_pages(lambda: guest2_page.evaluate("() => window.__game._otherPlayerPositions.length") == 2, all_pages, timeout=30)

    guest1_uid = guest1_page.evaluate("() => window.__game._multiplayerUid")
    print("guest1 (expected new host):", guest1_uid)

    # Spawn a zombie and give it an in-progress status effect BEFORE the
    # host disconnects, to confirm it survives the handoff, not just the
    # zombie's existence.
    host_page.evaluate("() => window.__game.zombies._spawnRandom()")
    zid = None
    for _ in range(40):
        zid = host_page.evaluate("() => window.__game.zombies.zombies.find((z) => z.state === 'alive')?.id")
        if zid is not None:
            break
        host_page.evaluate("() => window.__game.zombies._spawnRandom()")
    host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {zid})
        z.enragedUntil = performance.now() + 60000
        z.weakenedUntil = performance.now() + 60000
    }}""")
    print("zombie", zid, "given a 60s enrage/weaken status just before disconnect")

    # Let one more sync cycle broadcast this state before killing the host tab.
    time.sleep(1)
    for pg in all_pages:
        pg.evaluate("() => true")
    time.sleep(1)

    # Simulate a real host disconnect.
    host_page.close()
    print("host page closed - simulating a real disconnect")

    # The remaining players should detect this and guest1 should become host.
    guest1_became_host = poll_pages(lambda: guest1_page.evaluate("() => window.__game._multiplayerIsHost"), [guest1_page, guest2_page], timeout=60)
    print("PASS - guest1 (earliest-joined) became the new host:", guest1_became_host)
    guest2_saw_host_change = poll_pages(lambda: guest2_page.evaluate(f"() => window.__game._hostPlayerId === '{guest1_uid}'"), [guest1_page, guest2_page], timeout=30)
    print("PASS - guest2 recognizes guest1 as the new host:", guest2_saw_host_change)

    # The migrated zombie should still exist, on the NEW host, with its
    # status effect still meaningfully active (not reset to 0/expired).
    migrated_zombie_alive = poll_pages(lambda: guest1_page.evaluate(f"() => {{ const z = window.__game.zombies.zombies.find((zz) => zz.id === {zid}); return z ? z.state === 'alive' : false }}"), [guest1_page, guest2_page], timeout=30)
    print("PASS - the pre-existing zombie survived the handoff:", migrated_zombie_alive)
    enrage_remaining = guest1_page.evaluate(f"() => {{ const z = window.__game.zombies.zombies.find((zz) => zz.id === {zid}); return z ? z.enragedUntil - performance.now() : null }}")
    print("enrage time remaining on the new host (should be well over 0, roughly ~55-59s):", enrage_remaining)
    print("PASS - the in-progress status effect survived the handoff, not reset:", enrage_remaining is not None and enrage_remaining > 30000)

    # The world should keep moving - guest2 should see the zombie's
    # position actually change over the next several seconds (proof
    # the new host's real AI loop is genuinely driving it, not just
    # frozen at its last-known position).
    pos_before = guest2_page.evaluate(f"() => {{ const z = window.__game.zombies.sharedZombies.find((zz) => zz.id === {zid}); return z ? [z.group.position.x, z.group.position.z] : null }}")
    time.sleep(3)
    for pg in [guest1_page, guest2_page]:
        pg.evaluate("() => true")
    pos_after = guest2_page.evaluate(f"() => {{ const z = window.__game.zombies.sharedZombies.find((zz) => zz.id === {zid}); return z ? [z.group.position.x, z.group.position.z] : null }}")
    print("zombie position before/after 3s on the new host's watch:", pos_before, pos_after)
    print("PASS - the world is genuinely still running, not frozen:", pos_before != pos_after)

    browser.close()
```

Expected: every `PASS` line prints `True`.

- [ ] **Step 4: Claim-host rejection verification**

```python
from playwright.sync_api import sync_playwright
import time

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    guest1_page = browser.new_page()
    guest2_page = browser.new_page()

    host_page.goto('https://gayz.vercel.app', timeout=60000)
    deadline = time.time() + 60
    while time.time() < deadline and not host_page.evaluate("() => !!window.__game"):
        time.sleep(0.3)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
    session_id = host_page.evaluate("""async () => {
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")

    for gp in (guest1_page, guest2_page):
        gp.goto(f'https://gayz.vercel.app/?join={session_id}', timeout=60000)
        deadline = time.time() + 60
        while time.time() < deadline and not gp.evaluate("() => !!window.__game"):
            time.sleep(0.3)
        gp.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
        gp.evaluate(f"""async () => {{ await window.__game._joinMultiplayerSession('{session_id}') }}""")
        time.sleep(0.5)

    for pg in (host_page, guest1_page, guest2_page):
        pg.evaluate("() => { window.__game.gameStarted = true; window.__game.player.controls.isLocked = true; window.__game.playerState.alive = true }")

    # A claim attempted while the real host is still actively syncing must
    # be rejected, regardless of who's asking.
    host_page.evaluate("() => true")  # make sure the host's own state is fresh
    reject_active_host = guest2_page.evaluate("""async () => {
        const Multiplayer = await import('./Multiplayer.js')
        return await Multiplayer.claimHost(window.__game._multiplayerSessionId)
    }""")
    print("claim attempt while host is still active:", reject_active_host)
    print("PASS - rejected because the host is still active:", reject_active_host.get('ok') is False and reject_active_host.get('reason') == 'host-still-active')

    browser.close()
```

Expected: `PASS - rejected because the host is still active` prints `True`.

Note on scope versus the original spec's testing section: the spec's own testing-approach paragraph mentions verifying "a claim-host call from a non-earliest-joined player being rejected." Task 12's actual chosen design deliberately does NOT enforce that server-side (per its own stated reasoning: the server checks staleness and active-membership, not "is this claimant the exact election winner," matching this project's established trust-model precedent). A non-earliest-joined but genuinely active claimant calling `claimHost` while the real host IS stale would legitimately succeed by this design - that's correct, not a bug, since the client-side election (Task 11) is what normally prevents a non-winning client from ever attempting a claim in practice, and a "wrong" claim in a buggy-client scenario is an accepted, benign outcome (a wrong-but-active host, not corrupted state). The transaction guard's real job is only ever the near-simultaneous-claims race, which Step 3's own migration test already exercises indirectly (only guest1 ever attempts a claim there, since it's the only one whose election computation picks itself as the winner) rather than as a separate deliberately-forced-race test, since forcing a true simultaneous-claim race deterministically in Playwright would be inherently timing-fragile and isn't worth the flakiness for something the transaction's own atomicity already guarantees by construction.

- [ ] **Step 5: No commit needed** - this task deploys and verifies already-committed code from Tasks 1-15.

**Gaymi's test for this batch - needs at least one friend, ideally two, and needs real play, not just a spot-check:**
1. Start a session with 2-3 people (if you only have one friend available, 2-player is still worth confirming works exactly as before - nothing about the 2-player experience should have changed).
2. Play normally for a few minutes - kills, loot, everything from every earlier phase should feel unchanged.
3. **The real test:** whoever's hosting closes their browser tab or loses their connection (don't warn the others first). Within a few seconds, everyone else should get a small toast/notice, the game should NOT freeze, zombies should keep moving and attacking, and loot should keep working normally.
4. Confirm whoever's now hosting can still access it after refreshing later, and that no duplicate/frozen zombies appear anywhere.
5. If the original host comes back (reopens the link), confirm they rejoin as a regular player, not fighting for control.

**Not a bug:** a very brief pause (a couple of seconds) right at the moment of a disconnect before the world resumes - that's the detection window working as designed, not a hang.

**Failure looks like:** the game staying frozen after a host disconnects, duplicate or stuck zombies appearing, existing loot disappearing, or two players both acting like they're in charge at once.

---
