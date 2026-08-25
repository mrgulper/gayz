# Multiplayer Phase 3b: "Group A" Shared Zombie Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `shielded`, `screamer`, `stalker`, and `burrower` to the multiplayer shared-zombie list (bringing shared coverage from 11 to 15 of 29 types), and fix a real bug in the already-shipped Phase 3 where an ambush-spawned zombie (any of the 11 already-shared types can roll this 55-85% of the time) renders standing-up-immediately on a guest's screen instead of playing dead until approached.

**Architecture:** No new server endpoints, no new request/response shape beyond one new optional per-zombie boolean (`screaming`). Everything rides on the existing host-broadcasts-snapshot / guest-renders-visually model from Phase 3. All 4 types' extra behavior (shield bypass, scream glow, stealth fade, dormant/pop animation) is guest-side rendering catch-up inside `Zombie.js`'s `applyNetworkState`/`onHit`, which today only knows how to move a zombie and switch walk/idle/death clips.

**Tech Stack:** Vite/vanilla JS, Three.js, Vercel serverless functions (Firebase Admin SDK proxy), Playwright for verification (no test suite exists in this project).

**Spec:** `docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md`

## Global Constraints

- No new API endpoints - extend the existing `api/multiplayer/sync.js` only.
- `screamer_swarmer` stays excluded (its death-summon mechanic is out of scope for this phase - see spec).
- All 13 remaining excluded types (ranged, death-effects, bosses) stay untouched.
- Every completed update gets committed, and this project deploys straight to `gayz.vercel.app` production without a separate staging step (per this project's own CLAUDE.md standing rule) - Task 5 deploys with `--prod`.

---

### Task 1: Add the 4 types to the shared-zombie list

**Files:**
- Modify: `src/game/ZombieTypes.js:614-623`

**Interfaces:**
- Produces: `SHARED_ZOMBIE_TYPE_IDS` now includes `shielded`, `screamer`, `stalker`, `burrower` - every later task's verification depends on this.

- [ ] **Step 1: Update the shared-types comment and set**

Find:

```js
// Phase 3 of multiplayer (docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md) -
// only these plain melee types are shared across a session; everything
// else (ranged attackers, anything that explodes/gasses on death,
// burrowers, the shielded type, scream-summoners, and every boss tier)
// stays an independent per-player fight for now. See that spec's
// "Scope for this phase" section for the reasoning behind each exclusion.
export const SHARED_ZOMBIE_TYPE_IDS = new Set([
  'feral_dog', 'feral_child', 'shambler', 'runner', 'brute',
  'crawler', 'sewer_dweller', 'leaper', 'regenerator', 'bloodhound', 'vampire',
])
```

Replace with:

```js
// Phase 3 of multiplayer (docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md)
// plus Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md,
// which added shielded/screamer/stalker/burrower) - these types are shared
// across a session; everything else (ranged attackers, anything that
// explodes/gasses on death, scream-summoners like screamer_swarmer, and
// every boss tier) stays an independent per-player fight for now. See
// those specs' "Scope for this phase" sections for the reasoning behind
// each exclusion.
export const SHARED_ZOMBIE_TYPE_IDS = new Set([
  'feral_dog', 'feral_child', 'shambler', 'runner', 'brute',
  'crawler', 'sewer_dweller', 'leaper', 'regenerator', 'bloodhound', 'vampire',
  'shielded', 'screamer', 'stalker', 'burrower',
])
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/game/ZombieTypes.js
git commit -m "Add shielded/screamer/stalker/burrower to the shared-zombie list"
```

---

### Task 2: Forward the new `screaming` field through the sync endpoint

**Files:**
- Modify: `api/multiplayer/sync.js:47-56`

**Interfaces:**
- Consumes: nothing new from Task 1.
- Produces: the host's zombie snapshot (both what's stored server-side and what every player's sync response contains) now carries a `screaming` boolean per zombie. Task 4 sends it; Task 3's `applyNetworkState` reads it.

- [ ] **Step 1: Add `screaming` to the stored/forwarded snapshot fields**

Find:

```js
  if (isHost && Array.isArray(zombies)) {
    const zombiesById = {}
    for (const zb of zombies) {
      zombiesById[zb.id] = {
        x: zb.x, z: zb.z, rotY: zb.rotY, health: zb.health,
        maxHealth: zb.maxHealth, state: zb.state, type: zb.type, updatedAt: now,
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
      zombiesById[zb.id] = {
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

This endpoint explicitly whitelists which fields it stores/forwards field-by-field (it does not pass through an arbitrary object), so this line is required - the field would silently be dropped otherwise.

- [ ] **Step 2: Commit**

```bash
git add api/multiplayer/sync.js
git commit -m "Forward the screaming flag through the multiplayer sync endpoint"
```

**Note:** no deploy yet - Task 5 deploys everything together at the end, same as Phase 3's own plan.

---

### Task 3: Extend Zombie.js for the 4 new mechanics

**Files:**
- Modify: `src/game/Zombie.js` (constructor around line 424-430, `onHit` around line 2317-2326, `applyNetworkState` around line 1628-1655)

**Interfaces:**
- Consumes: `SHARED_ZOMBIE_TYPE_IDS` (Task 1, indirectly - only shared types ever get a network-driven instance at all), the `screaming` field (Task 2, read by `applyNetworkState`'s new parameter).
- Produces: `applyNetworkState(x, z, rotY, health, maxHealth, state, localPlayerX = null, localPlayerZ = null, screaming = false)` - Task 4's `_renderSharedZombies` calls this with the new 3 trailing args. `onHit`'s existing signature is unchanged, only its network-driven branch's internal behavior changes.

- [ ] **Step 1: Add two new tracking fields to the constructor**

Find:

```js
    // Phase 3 multiplayer (see this class's applyNetworkState/onHit below,
    // and docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md) -
    // true only for a guest's rendering of a zombie the HOST is actually
    // simulating. Everything else about construction (visuals, materials,
    // health bar) runs exactly the same either way; only update()
    // (never called for these) and onHit() (redirected below) differ.
    this.isNetworkDriven = isNetworkDriven
```

Replace with:

```js
    // Phase 3 multiplayer (see this class's applyNetworkState/onHit below,
    // and docs/superpowers/specs/2026-08-24-multiplayer-phase3-shared-zombies-design.md) -
    // true only for a guest's rendering of a zombie the HOST is actually
    // simulating. Everything else about construction (visuals, materials,
    // health bar) runs exactly the same either way; only update()
    // (never called for these) and onHit() (redirected below) differ.
    this.isNetworkDriven = isNetworkDriven
    // Phase 3b (docs/superpowers/specs/2026-08-24-multiplayer-phase3b-groupa-zombies-design.md) -
    // local timestamps applyNetworkState uses to replicate the
    // dormant->popping scale/eye-glow animation and the screamer's
    // throat-glow pulse, neither of which this class's real per-frame
    // update() ever runs for a network-driven instance. Purely cosmetic
    // local approximations - never sent over the network themselves.
    this._netPopStartedAt = 0
    this._netScreamPulseUntil = 0
    this._netWasScreaming = false
```

- [ ] **Step 2: Fix the shield-bypass fold in `onHit`'s network-driven branch**

Find:

```js
  onHit(damage, opts = {}) {
    if (this.isNetworkDriven) {
      // Not authoritative - this instance is a guest's rendering of a
      // zombie the host is really simulating, so don't touch health
      // locally at all. Game.js sets _onNetworkHit right after
      // constructing one of these (see _renderSharedZombies) to queue
      // the hit for the next sync call instead.
      if (typeof this._onNetworkHit === 'function') this._onNetworkHit(damage, opts)
      return
    }
```

Replace with:

```js
  onHit(damage, opts = {}) {
    if (this.isNetworkDriven) {
      // Not authoritative - this instance is a guest's rendering of a
      // zombie the host is really simulating, so don't touch health
      // locally at all. Game.js sets _onNetworkHit right after
      // constructing one of these (see _renderSharedZombies) to queue
      // the hit for the next sync call instead.
      //
      // Phase 3b shielded fix: the real (non-network) onHit below treats
      // a melee hit (this.lastHitWeaponId === 'melee', set by
      // WeaponSystem._fire right before every onHit call) as bypassing
      // the shield, same as opts.bypassShield (Armor-Piercing Rounds).
      // Without folding that in here too, a guest's melee hit against a
      // shared shielded zombie would be reported with bypassShield only
      // reflecting opts (never true for a plain melee swing), and the
      // host would incorrectly drain the shield pool instead of health
      // when it replays the report.
      if (typeof this._onNetworkHit === 'function') {
        const effectiveBypass = !!opts.bypassShield || this.lastHitWeaponId === 'melee'
        this._onNetworkHit(damage, { ...opts, bypassShield: effectiveBypass })
      }
      return
    }
```

- [ ] **Step 3: Extend `applyNetworkState` with the 4 new behaviors**

Find:

```js
  applyNetworkState(x, z, rotY, health, maxHealth, state) {
    const moved = Math.hypot(x - this.group.position.x, z - this.group.position.z)
    this.group.position.set(x, 0, z)
    this.group.rotation.y = rotY
    this.health = health
    this.maxHealth = maxHealth
    if (state !== this.state) {
      this.state = state
      if (state === 'dying' || state === 'dead') this._playGlbAction('death', false)
    }
    if (state === 'alive' || state === 'popping') {
      this._barSprite.visible = true
      this._redrawHealthBar()
      this._playGlbAction(moved > 0.01 ? 'walk' : 'idle', true)
    }
    const now = performance.now()
    const dt = Math.min(0.2, (now - (this._lastNetworkUpdateAt || now)) / 1000)
    this._lastNetworkUpdateAt = now
    if (this.mixer) this.mixer.update(dt)
  }
```

Replace with:

```js
  applyNetworkState(x, z, rotY, health, maxHealth, state, localPlayerX = null, localPlayerZ = null, screaming = false) {
    const moved = Math.hypot(x - this.group.position.x, z - this.group.position.z)
    this.group.position.set(x, 0, z)
    this.group.rotation.y = rotY
    this.health = health
    this.maxHealth = maxHealth
    if (state === 'popping' && this.state === 'dormant') this._netPopStartedAt = performance.now()
    if (state !== this.state) {
      this.state = state
      if (state === 'dying' || state === 'dead') this._playGlbAction('death', false)
    }
    // Burrower (and any other shared type that happened to roll an ambush
    // spawn - see ZombieManager._spawnRandom's ambushChance, which applies
    // to every non-ranged type, not just burrower) - mirrors update()'s
    // own dormant->popping scale+eye-glow lerp, which never runs for a
    // network-driven instance since update() itself never runs for one.
    // Only Y scale changes - X/Z stay at the construction-time
    // baseScale*glbWidthMult, same as the AI-driven version.
    if (state === 'dormant') {
      this.group.scale.y = this.baseScale * 0.35
      for (const mat of this.eyeMaterials) mat.emissiveIntensity = 0.25
    } else if (state === 'popping') {
      const progress = Math.min(1, (performance.now() - this._netPopStartedAt) / this.popDurationMs)
      this.group.scale.y = THREE.MathUtils.lerp(this.baseScale * 0.35, this.baseScale, progress)
      for (const mat of this.eyeMaterials) mat.emissiveIntensity = THREE.MathUtils.lerp(0.25, 2.4, progress)
    } else if (state === 'alive') {
      this.group.scale.y = this.baseScale
    }
    if (state === 'alive' || state === 'popping') {
      this._barSprite.visible = true
      this._redrawHealthBar()
      this._playGlbAction(moved > 0.01 ? 'walk' : 'idle', true)
    }
    // Stalker - same distance-to-opacity fade update() already does for an
    // AI-driven instance (see this.config.stealthy in update()), computed
    // against the LOCAL viewer's own position (passed in by Game.js's
    // _renderSharedZombies) rather than the host's, so it fades in
    // correctly for whichever player is actually looking at it.
    if (this.config.stealthy && localPlayerX !== null && localPlayerZ !== null) {
      const dist = Math.hypot(localPlayerX - x, localPlayerZ - z)
      const targetOpacity = THREE.MathUtils.clamp(1 - dist / this.config.revealRadius, 0.12, 1)
      for (const mat of this.materials) {
        mat.transparent = true
        mat.opacity = targetOpacity
      }
    }
    // Screamer's throat-glow pulse - cosmetic only (the real effect, waking
    // nearby dormant zombies, is entirely host-side already and needs no
    // network changes at all). Simplified to a flat on/off glow rather
    // than replicating the sine-wave scale pulse _animate() does, since
    // this only updates a few times a second (sync cadence) anyway.
    if (this.throatMat) {
      if (screaming && !this._netWasScreaming) this._netScreamPulseUntil = performance.now() + 500
      this._netWasScreaming = screaming
      this.throatMat.emissiveIntensity = performance.now() < this._netScreamPulseUntil ? 2.4 : 0.9
    }
    const now = performance.now()
    const dt = Math.min(0.2, (now - (this._lastNetworkUpdateAt || now)) / 1000)
    this._lastNetworkUpdateAt = now
    if (this.mixer) this.mixer.update(dt)
  }
```

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/game/Zombie.js
git commit -m "Teach applyNetworkState to render shielded/screamer/stalker/burrower correctly"
```

---

### Task 4: Wire the new fields through Game.js

**Files:**
- Modify: `src/game/Game.js` (`_syncNetworkPlayerState` around line 15497-15535, `_renderSharedZombies` around line 15575-15599)

**Interfaces:**
- Consumes: `applyNetworkState`'s new 3 trailing parameters (Task 3).
- Produces: nothing new consumed by later tasks - Task 5 is deploy + verification only.

- [ ] **Step 1: Include `screaming` in the host's zombie snapshot**

Find:

```js
    if (this._multiplayerIsHost) {
      payload.zombies = this.zombies.zombies
        .filter((z) => SHARED_ZOMBIE_TYPE_IDS.has(z.type) && z.state !== 'dead')
        .map((z) => ({
          id: z.id, x: z.group.position.x, z: z.group.position.z, rotY: z.group.rotation.y,
          health: z.health, maxHealth: z.maxHealth, state: z.state, type: z.type,
        }))
    } else if (this._pendingZombieHits.length) {
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
        }))
    } else if (this._pendingZombieHits.length) {
```

- [ ] **Step 2: Pass the local player's own position through to `_renderSharedZombies`**

Find:

```js
        if (this._multiplayerIsHost) {
          for (const hit of pendingHits) {
            const zombie = this.zombies.zombies.find((z) => z.id === hit.zombieId)
            if (zombie) zombie.onHit(hit.damage, { bypassShield: hit.bypassShield })
          }
        } else {
          this._renderSharedZombies(zombies)
        }
```

Replace with:

```js
        if (this._multiplayerIsHost) {
          for (const hit of pendingHits) {
            const zombie = this.zombies.zombies.find((z) => z.id === hit.zombieId)
            if (zombie) zombie.onHit(hit.damage, { bypassShield: hit.bypassShield })
          }
        } else {
          this._renderSharedZombies(zombies, feetX, feetZ)
        }
```

`feetX`/`feetZ` are already computed at the top of this same method (this player's own feet position) - no new variables needed.

- [ ] **Step 3: Thread the new params into `_renderSharedZombies` and `applyNetworkState`**

Find:

```js
  _renderSharedZombies(zombiesSnapshot) {
    const seenIds = new Set()
    for (const [idStr, state] of Object.entries(zombiesSnapshot)) {
      const id = Number(idStr)
      seenIds.add(id)
      let zombie = this._sharedZombieBodies.get(id)
      if (!zombie) {
        const typeConfig = ZOMBIE_TYPES[state.type]
        if (!typeConfig) continue
        zombie = new Zombie(state.x, state.z, typeConfig, false, false, 1, 1, 1, true)
        zombie.id = id
        zombie._onNetworkHit = (damage, opts) => {
          this._pendingZombieHits.push({ zombieId: id, damage, bypassShield: !!opts.bypassShield })
        }
        this._sharedZombieBodies.set(id, zombie)
        this.zombies.sharedZombies.push(zombie)
      }
      zombie.applyNetworkState(state.x, state.z, state.rotY, state.health, state.maxHealth, state.state)
    }
```

Replace with:

```js
  _renderSharedZombies(zombiesSnapshot, localPlayerX, localPlayerZ) {
    const seenIds = new Set()
    for (const [idStr, state] of Object.entries(zombiesSnapshot)) {
      const id = Number(idStr)
      seenIds.add(id)
      let zombie = this._sharedZombieBodies.get(id)
      if (!zombie) {
        const typeConfig = ZOMBIE_TYPES[state.type]
        if (!typeConfig) continue
        zombie = new Zombie(state.x, state.z, typeConfig, false, false, 1, 1, 1, true)
        zombie.id = id
        zombie._onNetworkHit = (damage, opts) => {
          this._pendingZombieHits.push({ zombieId: id, damage, bypassShield: !!opts.bypassShield })
        }
        this._sharedZombieBodies.set(id, zombie)
        this.zombies.sharedZombies.push(zombie)
      }
      zombie.applyNetworkState(state.x, state.z, state.rotY, state.health, state.maxHealth, state.state, localPlayerX, localPlayerZ, !!state.screaming)
    }
```

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds, no leftover 2-arg `_renderSharedZombies(zombies)` call sites anywhere in `Game.js`.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "Wire local player position and the screaming flag into shared-zombie rendering"
```

---

### Task 5: Deploy and verify with two real browser sessions

**Files:**
- None (deploy + verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-4.

- [ ] **Step 1: Deploy to production**

```bash
npx vercel --prod --yes
```

- [ ] **Step 2: Two-browser Playwright verification**

Same environment gotchas as every prior multiplayer verification this session (this project's own CLAUDE.md): headless Playwright can't grant real Pointer Lock, and there's no direct "spawn this exact type" method - force each type by looping the real `_spawnRandom()` call and checking after each try, same technique Phase 3's own plan used.

```python
from playwright.sync_api import sync_playwright
import time

def poll(fn, expect_truthy=True, timeout=180, interval=1):
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

    host_page.goto('https://gayz.vercel.app', timeout=60000)
    poll(lambda: host_page.evaluate("() => !!window.__game"), timeout=60)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    session_id = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'ZombieHost'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session:", session_id)

    guest_page.goto(f'https://gayz.vercel.app/?join={session_id}', timeout=60000)
    poll(lambda: guest_page.evaluate("() => !!window.__game"), timeout=60)
    guest_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
    guest_page.evaluate(f"""async () => {{
        window.__game.settings.nickname = 'ZombieGuest'
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

    def force_spawn(type_id):
        for _ in range(40):
            host_page.evaluate("() => window.__game.zombies._spawnRandom()")
            zid = host_page.evaluate(f"""() => {{
                const z = window.__game.zombies.zombies.find((zz) => zz.type === '{type_id}')
                return z ? z.id : null
            }}""")
            if zid is not None:
                return zid
        return None

    results = {}

    # --- Burrower: squash-then-pop-up visual ---
    burrower_id = force_spawn('burrower')
    print("forced a burrower to spawn on the host:", burrower_id is not None)
    poll(lambda: guest_page.evaluate("() => window.__game._sharedZombieBodies.size") >= 1, timeout=180)
    squashed = guest_page.evaluate(f"""() => {{
        const z = window.__game._sharedZombieBodies.get({burrower_id})
        return z ? z.group.scale.y / z.baseScale : null
    }}""")
    print("burrower's guest-side scale ratio right after appearing (expect ~0.35):", squashed)
    results['burrower_squashed'] = squashed is not None and 0.2 < squashed < 0.5
    popped_up = poll(lambda: guest_page.evaluate(f"""() => {{
        const z = window.__game._sharedZombieBodies.get({burrower_id})
        return z ? z.group.scale.y / z.baseScale > 0.9 : false
    }}"""), timeout=25)
    print("burrower reached full height on the guest's screen within 25s:", popped_up)
    results['burrower_popped'] = popped_up

    # --- Shielded: melee bypass still works when reported over the network ---
    shielded_id = force_spawn('shielded')
    print("forced a shielded zombie to spawn on the host:", shielded_id is not None)
    poll(lambda: guest_page.evaluate(f"() => window.__game._sharedZombieBodies.has({shielded_id})"), timeout=180)
    before = host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {shielded_id})
        return {{ health: z.health, shieldHealth: z.shieldHealth }}
    }}""")
    print("shielded zombie before the guest's melee hit:", before)
    guest_page.evaluate(f"""() => {{
        const z = window.__game._sharedZombieBodies.get({shielded_id})
        z.lastHitWeaponId = 'melee'
        z.onHit(30, {{}})
    }}""")
    poll(lambda: host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {shielded_id})
        return z.health
    }}""") < before['health'], timeout=180)
    after = host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {shielded_id})
        return {{ health: z.health, shieldHealth: z.shieldHealth }}
    }}""")
    print("shielded zombie after the guest's reported melee hit:", after)
    results['shield_bypassed'] = after['shieldHealth'] == before['shieldHealth'] and after['health'] < before['health']

    # --- Screamer: the 'screaming' flag reaches the guest and drives the glow ---
    screamer_id = force_spawn('screamer')
    print("forced a screamer to spawn on the host:", screamer_id is not None)
    poll(lambda: guest_page.evaluate(f"() => window.__game._sharedZombieBodies.has({screamer_id})"), timeout=180)
    host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {screamer_id})
        z.screamPulseUntil = performance.now() + 500
    }}""")
    glow_seen = poll(lambda: guest_page.evaluate(f"""() => {{
        const z = window.__game._sharedZombieBodies.get({screamer_id})
        return z && z.throatMat ? z.throatMat.emissiveIntensity > 2 : false
    }}"""), timeout=180)
    print("guest saw the screamer's throat glow after the host's scream:", glow_seen)
    results['screamer_glow'] = glow_seen

    # --- Stalker: opacity fades using the LOCAL guest's own position ---
    stalker_id = force_spawn('stalker')
    print("forced a stalker to spawn on the host:", stalker_id is not None)
    poll(lambda: guest_page.evaluate(f"() => window.__game._sharedZombieBodies.has({stalker_id})"), timeout=180)
    opacity_check = guest_page.evaluate(f"""() => {{
        const z = window.__game._sharedZombieBodies.get({stalker_id})
        const x = z.group.position.x, zz = z.group.position.z
        z.applyNetworkState(x, zz, z.group.rotation.y, z.health, z.maxHealth, z.state, x + 200, zz + 200, false)
        const farOpacity = [...z.materials][0].opacity
        z.applyNetworkState(x, zz, z.group.rotation.y, z.health, z.maxHealth, z.state, x, zz, false)
        const nearOpacity = [...z.materials][0].opacity
        return {{ far: farOpacity, near: nearOpacity }}
    }}""")
    print("stalker opacity far vs near (expect far << near):", opacity_check)
    results['stalker_opacity'] = opacity_check['near'] > opacity_check['far']

    print("RESULTS:", results)
    browser.close()
```

Expected: every value in the printed `RESULTS` dict is `True`.

- [ ] **Step 3: No commit needed** - this task deploys and verifies already-committed code from Tasks 1-4.

**Gaymi's test for this batch - needs your friend again:**
1. Start a run, invite your friend the same way as before, both of you join the same session.
2. Walk around until you or your friend spot one of the 4 new types: a **stalker** (mostly see-through until you're close), a **screamer** (its scream should visibly glow its throat), a **burrower** or any zombie that was clearly "playing dead" until someone got close, or a **shielded** riot-corpse type.
3. Whichever of you sees it first, both of you should see the exact same one in the exact same spot, matching all of Phase 3's original checks (same health, dies for both at once, doesn't come back once killed).
4. For a shielded one specifically: melee it (not a gun) - it should take damage immediately even though a shield is supposed to block bullets. Shoot it with a gun instead - it should NOT lose health until the shield depletes first (a small “still blocked” moment before it starts taking real damage).
5. For a burrower/dormant one: whichever of you is NOT the one who triggered it should still see it lying flat/hidden until it pops up, not just standing there the whole time.

**What's still normal, not a bug:** all 13 remaining excluded types (ranged attackers, exploders/fester/acid trail/brittle, spitter_bomber, screamer_swarmer, and all 3 bosses) are still fought independently by each player.

**Failure looks like:** a shielded zombie takes gun damage through its shield, a burrower/dormant zombie looks fully awake on your friend's screen the whole time, or a stalker looks the same opacity for both of you regardless of who's actually close to it.
