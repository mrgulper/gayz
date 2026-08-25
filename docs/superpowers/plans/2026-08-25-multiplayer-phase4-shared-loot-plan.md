# Multiplayer Phase 4: Shared Loot/Interactables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share ground loot drops, chests/the Vault, and barricade window repairs across a multiplayer session, so a guest actually sees them (today they don't at all) and two players can't double-claim the same one.

**Architecture:** Same host-authoritative model as every earlier phase. The host's real `PickupManager`/`ChestManager`/`Vault`/`BarricadeWindows` stay the source of truth and get broadcast; a guest renders from those broadcasts instead of running its own independent (and, for pickups/chest-rerolls, incorrect) local simulation. Whoever physically interacts with something (walks into a drop, presses interact on a chest/vault/window) applies the benefit to themselves locally *immediately* (existing single-player code, unchanged - so it still feels instant) and separately reports what happened to the host, which is what actually keeps the shared state correct for both players going forward.

**Tech Stack:** Vite/vanilla JS, Three.js, Vercel serverless functions (Firebase Admin SDK proxy), Playwright for verification.

**Spec:** `docs/superpowers/specs/2026-08-25-multiplayer-phase4-shared-loot-design.md`

## Global Constraints

- Reward crediting: whoever physically interacts gets the real benefit (points, ammo, health, loot) - not the host by default, matching the spec's own stated reasoning for why this differs from the zombie-kill-credit gap.
- No new ids for chests/the Vault/barricade windows - their positions are fixed and identical for every player (deterministic world generation), so state syncs by plain array index.
- Ground loot needs real ids (dynamic, spawned at runtime) - mirror `Zombie.js`'s `zombieIdCounter` pattern exactly.
- Any object stored in Firebase keyed by an incrementing counter (loot pickup ids) uses the same non-numeric-prefixed-key precaution `world/zombies` already uses - a bare numeric-looking key silently becomes a sparse array with `null` gaps, a real bug this project hit and fixed once already tonight.
- A single new `interactions` list (not four separate ones) carries every guest-to-host report (`collectPickup`, `openChest`, `openVault`, `repairWindow`), discriminated by a `kind` field - mirrors how `remoteDamage` already uses `kind` to distinguish `'damage'`/`'pull'`/`'disorient'` in one list rather than three.
- **Important discovery this plan's research turned up, not covered by the spec's simpler "just a bool" framing:** `ChestManager.refillNight()` (called every game-night) *re-locks every chest and randomly picks 3 new ones to unlock* - if a guest ran this locally, it would independently roll a completely different set of unlocked chests than the host. So chest state needs `{locked, opened}` per index (not just `opened`), and `refillNight()`/`reset()` must never run on a guest - only the host calls them; a guest's own chest objects have their `locked`/`opened` fields set directly from the host's broadcast instead.
- **Known limitation, not covered by this plan:** `ChestManager.addChest(...)` (the random "Supply Drop" night event) pushes a brand-new chest onto the host's own `chests` array at runtime, growing its length. Since a guest's own `chests` array was only ever built from the same fixed initial spots at construction time, its length can fall behind the host's after a Supply Drop fires mid-session - the index-based sync this plan uses would then be reading past the end of the guest's own array for that one extra chest until the guest's next full page load. This is the same category of scope cut as Phase 3b's `screamer_swarmer` exclusion - a real, narrow gap, accepted rather than building dynamic chest ids for one rare event.

---

### Task 1: Give Pickup instances a real id

**Files:**
- Modify: `src/game/Pickups.js` (top of file, the `Pickup` class constructor)

**Interfaces:**
- Produces: every `Pickup` instance has a real, globally-unique `.id` (number) - Task 3's host broadcast and Task 5's `_renderSharedPickups` both key on this.

- [ ] **Step 1: Add a module-level counter and assign it in the constructor**

Find:

```js
const PICKUP_RADIUS = 1.4
const LOOT_EXPIRE_MS = 25000
```

Replace with:

```js
const PICKUP_RADIUS = 1.4
const LOOT_EXPIRE_MS = 25000

// Phase 4 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase4-shared-loot-design.md) -
// same globally-incrementing-id pattern as Zombie.js's zombieIdCounter,
// needed so the host can broadcast "this exact drop exists" and a guest
// can report back "I collected id N" without any ambiguity.
let pickupIdCounter = 0
```

- [ ] **Step 2: Assign it in the `Pickup` constructor**

Find:

```js
class Pickup {
  constructor(type, x, z, isLoot = false, options = {}) {
    const { floatY } = options
    this.type = type
    this.active = true
```

Replace with:

```js
class Pickup {
  constructor(type, x, z, isLoot = false, options = {}) {
    const { floatY } = options
    this.id = pickupIdCounter++
    this.type = type
    this.active = true
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/game/Pickups.js
git commit -m "Give Pickup instances a real id (multiplayer Phase 4)"
```

---

### Task 2: Add a guest-side shared-pickups array and its proximity-collect method

**Files:**
- Modify: `src/game/Pickups.js` (`PickupManager` constructor and a new method)

**Interfaces:**
- Consumes: `Pickup.id` (Task 1).
- Produces: `PickupManager.sharedPickups` (array, guest-side network-driven `Pickup` instances - Task 5 populates it) and `PickupManager.updateSharedPickups(dt, elapsed, playerPos, onCollect)` (Task 5 calls this every guest tick; `onCollect(id)` fires once per collected id and the method removes that entry from `sharedPickups` immediately, so the same drop can't be reported twice while waiting for the next sync round trip).

- [ ] **Step 1: Add the array**

Find:

```js
  constructor(scene, spawnPoints) {
    this.scene = scene
    this.spawnPoints = spawnPoints
    this.pickups = []
  }
```

Replace with:

```js
  constructor(scene, spawnPoints) {
    this.scene = scene
    this.spawnPoints = spawnPoints
    this.pickups = []
    // Phase 4 multiplayer - a guest's network-driven Pickup instances (see
    // Game.js's _renderSharedPickups), kept separate from this.pickups (the
    // real, host-simulated array) the same way ZombieManager.sharedZombies
    // is kept separate from ZombieManager.zombies.
    this.sharedPickups = []
  }
```

- [ ] **Step 2: Add the proximity-collect method for shared pickups**

Add this method right after the existing `update(...)` method (which ends with the `_collect` line filtering `this.pickups`):

```js
  // Guest-side only counterpart to update() above, checked against
  // sharedPickups (network-driven, see _renderSharedPickups) instead of
  // this.pickups (the real array, which only the host ever populates in a
  // shared session). Reuses the exact same radius math as update() but
  // calls onCollect(id) instead of a full handlers object, since applying
  // the actual pickup effect (ammo/health/etc.) is the caller's job here -
  // this method's only responsibility is "is the local player standing on
  // this one, and if so, stop showing/considering it locally right away."
  updateSharedPickups(dt, elapsed, playerPos, onCollect) {
    for (const pickup of this.sharedPickups) pickup.update(dt, elapsed)
    const toRemove = []
    for (const pickup of this.sharedPickups) {
      const dist = Math.hypot(playerPos.x - pickup.group.position.x, playerPos.z - pickup.group.position.z)
      if (dist <= PICKUP_RADIUS) toRemove.push(pickup)
    }
    for (const pickup of toRemove) {
      this.scene.remove(pickup.group)
      const idx = this.sharedPickups.indexOf(pickup)
      if (idx !== -1) this.sharedPickups.splice(idx, 1)
      // Pass the type along too - by this point the pickup is already
      // spliced out of sharedPickups, so the caller can't look it back up
      // by id to find out what it was.
      onCollect(pickup.id, pickup.type)
    }
  }
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/game/Pickups.js
git commit -m "Add guest-side shared pickups array and proximity-collect method (Phase 4)"
```

---

### Task 3: Gate guest-side local simulation for pickups, chest rerolls, and vault bonus loot

**Files:**
- Modify: `src/game/Game.js` (`_tick()`'s calls to `this.pickups.update`/`this.chests.refillNight`/`this.chests.reset`, and `_openVault`)

**Interfaces:**
- Consumes: `this._multiplayerSessionId`/`this._multiplayerIsHost` (existing fields from Phase 3).
- Produces: nothing new consumed by later tasks - this just stops a guest from running simulation that would otherwise be wrong (an empty/independent pickups array, an independently-rerolled chest lock state).

- [ ] **Step 1: Gate the pickups update call**

Find in `_tick()`:

```js
      const pickupRadiusMult = (this.settings.autoLoot ? AUTO_LOOT_RADIUS_MULT : 1) * (this.hasPickupMagnet ? PICKUP_MAGNET_MULT : 1)
      this.pickups.update(dt, elapsed, playerPos, {
        onPickup: (type, label, isLoot) => this._onPickup(type, label, isLoot),
      }, companionLootPos, pickupRadiusMult)
```

Replace with:

```js
      const pickupRadiusMult = (this.settings.autoLoot ? AUTO_LOOT_RADIUS_MULT : 1) * (this.hasPickupMagnet ? PICKUP_MAGNET_MULT : 1)
      // A guest in a shared session never runs its own real pickup
      // simulation - it would only ever be empty anyway, since a guest
      // never processes zombie kills (see ZombieManager gating from Phase
      // 3) or chest openings for itself. It only ever collects from what
      // the host broadcasts - see _renderSharedPickups/_syncNetworkPlayerState.
      if (!this._multiplayerSessionId || this._multiplayerIsHost) {
        this.pickups.update(dt, elapsed, playerPos, {
          onPickup: (type, label, isLoot) => this._onPickup(type, label, isLoot),
        }, companionLootPos, pickupRadiusMult)
      }
```

- [ ] **Step 2: Gate the nightly chest reroll**

Find:

```js
        this.chests.refillNight()
```

Replace with:

```js
        // A guest never rerolls its own chest lock state - refillNight()
        // picks 3 random chests to unlock, and an independent roll would
        // desync from the host's real choice immediately. The host's
        // choice reaches a guest via the chests broadcast instead.
        if (!this._multiplayerSessionId || this._multiplayerIsHost) this.chests.refillNight()
```

- [ ] **Step 3: Gate the respawn/round-reset chest reroll**

Find:

```js
      this.chests.reset()
```

Replace with:

```js
      if (!this._multiplayerSessionId || this._multiplayerIsHost) this.chests.reset()
```

- [ ] **Step 4: Keep the Vault's bonus loot-drop spawn host-only**

Find:

```js
  _openVault() {
    if (this.vault.opened) return
    if (!this.inventory.useVaultKey()) {
      this._showLoreToast(t('toastVaultLocked'))
      return
    }
    this.vault.open()
    this._gainPoints(VAULT_REWARD_POINTS)
    this._updateStatsPanel()
    this.pickups.spawnLootDrop('legendary_weapon', this.vault.x, this.vault.z + 1)
    // Rare bonus second reward roll - the vault only ever opens once per
    // run (this.vault.opened above), so this is the one chance to roll it.
    if (Math.random() < VAULT_BONUS_ROLL_CHANCE) {
      this.pickups.spawnLootDrop('rare_weapon', this.vault.x, this.vault.z - 1)
      this._showLoreToast(t('toastVaultBonusRoll'))
    } else {
      this._showLoreToast(t('toastVaultOpened', { n: VAULT_REWARD_POINTS }))
    }
  }
```

Replace with:

```js
  _openVault() {
    if (this.vault.opened) return
    if (!this.inventory.useVaultKey()) {
      this._showLoreToast(t('toastVaultLocked'))
      return
    }
    this.vault.open()
    this._gainPoints(VAULT_REWARD_POINTS)
    this._updateStatsPanel()
    // Phase 4 multiplayer - the bonus loot drops only ever mean anything if
    // they end up in the HOST's own PickupManager.pickups (the array that
    // actually gets broadcast - see _syncNetworkPlayerState). A guest
    // opening the vault reports {kind: 'openVault'} instead of spawning
    // these itself (which nobody would ever see); the host spawns them
    // when it processes that report - see the interactions-handling code
    // in _syncNetworkPlayerState.
    if (!this._multiplayerSessionId || this._multiplayerIsHost) {
      this.pickups.spawnLootDrop('legendary_weapon', this.vault.x, this.vault.z + 1)
      if (Math.random() < VAULT_BONUS_ROLL_CHANCE) {
        this.pickups.spawnLootDrop('rare_weapon', this.vault.x, this.vault.z - 1)
        this._showLoreToast(t('toastVaultBonusRoll'))
      } else {
        this._showLoreToast(t('toastVaultOpened', { n: VAULT_REWARD_POINTS }))
      }
    } else {
      this._showLoreToast(t('toastVaultOpened', { n: VAULT_REWARD_POINTS }))
      this._queueMultiplayerInteraction({ kind: 'openVault' })
    }
  }
```

(`_queueMultiplayerInteraction` is added in Task 4 - this file compiles fine even before that method exists yet within the same task's edits, since JS doesn't check method existence until the method is actually called, but Task 4 must land before this is exercised in the field. Since both are in this same plan executed in order, this is fine.)

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "Gate guest-side pickup/chest-reroll/vault-bonus simulation to host-only (Phase 4)"
```

---

### Task 4: Add the interactions queue and chest/vault/window interact reporting

**Files:**
- Modify: `src/game/Game.js` (constructor, the chest-interact/vault-interact/barricade-repair keydown handlers)

**Interfaces:**
- Produces: `this._pendingInteractions` (array), `this._queueMultiplayerInteraction(entry)` (pushes into it, only when in a shared guest session) - Task 6's `_syncNetworkPlayerState` drains this into the outgoing sync payload.

- [ ] **Step 1: Add the queue field and helper method**

Find in the constructor:

```js
    this._pendingWorldEvents = []
    this._nextHazardEventId = 0
    this._seenWorldEventIds = new Set() // Phase 3c - dedupes replayed world events across sync calls, both host and guest
```

Replace with:

```js
    this._pendingWorldEvents = []
    this._nextHazardEventId = 0
    this._seenWorldEventIds = new Set() // Phase 3c - dedupes replayed world events across sync calls, both host and guest
    // Phase 4 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase4-shared-loot-design.md) -
    // one combined queue for every kind of "I did something" report a
    // GUEST needs to tell the host about (collecting a pickup, opening a
    // chest/the vault, repairing a window) - discriminated by entry.kind,
    // same shape as ZombieManager.remoteDamageQueue's own kind field.
    this._pendingInteractions = []
```

Find the class's other small helper methods (any reasonable existing one-liner helper, e.g. right after `_onZombiePull`) and add nearby:

```js
  // Only ever meaningful for a guest (the host applies its own
  // interactions directly, it never needs to report them to itself) -
  // still safe to call unconditionally, since it's a no-op whenever
  // _multiplayerIsHost is true or there's no session at all.
  _queueMultiplayerInteraction(entry) {
    if (!this._multiplayerSessionId || this._multiplayerIsHost) return
    this._pendingInteractions.push(entry)
  }
```

- [ ] **Step 2: Report a pickup collection**

This step's actual call site is added in Task 5 (guest-side `_renderSharedPickups`/`updateSharedPickups` wiring) - no code change here, just confirming the helper exists for it to call.

- [ ] **Step 3: Report a chest open**

Find:

```js
        } else {
          const openedChestPos = this.chests.nearbyChest ? { x: this.chests.nearbyChest.x, y: this.chests.nearbyChest.y, z: this.chests.nearbyChest.z } : null
          const loot = this.chests.tryInteract()
          if (loot) {
            this._onPickup(loot.type, loot.label, false, loot.count)
            this.interactPrompt.style.display = 'none'
            // Rarity-tinted crate-opening burst (batch 7 feature) - captured
            // the chest's position above, before tryInteract() cleared
            // nearbyChest, since this is the only handle Game.js has on it.
            if (openedChestPos) this._spawnCrateOpenBurst(openedChestPos.x, openedChestPos.y, openedChestPos.z, loot.type)
          } else if (this.nearGenerator && this.inventory.useFuelCan()) {
```

Replace with:

```js
        } else {
          const openedChestPos = this.chests.nearbyChest ? { x: this.chests.nearbyChest.x, y: this.chests.nearbyChest.y, z: this.chests.nearbyChest.z } : null
          // Captured before tryInteract() clears nearbyChest - chests are
          // fixed, deterministic positions (see this plan's own header
          // note), so an index into this.chests.chests is a stable,
          // globally-shared identity with no new id needed.
          const openedChestIndex = this.chests.nearbyChest ? this.chests.chests.indexOf(this.chests.nearbyChest) : -1
          const loot = this.chests.tryInteract()
          if (loot) {
            this._onPickup(loot.type, loot.label, false, loot.count)
            this.interactPrompt.style.display = 'none'
            // Rarity-tinted crate-opening burst (batch 7 feature) - captured
            // the chest's position above, before tryInteract() cleared
            // nearbyChest, since this is the only handle Game.js has on it.
            if (openedChestPos) this._spawnCrateOpenBurst(openedChestPos.x, openedChestPos.y, openedChestPos.z, loot.type)
            if (openedChestIndex !== -1) this._queueMultiplayerInteraction({ kind: 'openChest', chestIndex: openedChestIndex })
          } else if (this.nearGenerator && this.inventory.useFuelCan()) {
```

- [ ] **Step 4: Report a barricade repair**

Find:

```js
        } else if (this.nearBarricadeWindow) {
          const reward = this.barricadeWindows.repair(this.nearBarricadeWindow)
          if (reward > 0) {
            this._gainPoints(reward)
            this._updateStatsPanel()
          }
```

Replace with:

```js
        } else if (this.nearBarricadeWindow) {
          // Fixed positions (see this plan's header note) - an index into
          // this.barricadeWindows.windows is a stable, globally-shared
          // identity, captured before repair() below changes this window's
          // own state.
          const repairedWindowIndex = this.barricadeWindows.windows.indexOf(this.nearBarricadeWindow)
          const reward = this.barricadeWindows.repair(this.nearBarricadeWindow)
          if (reward > 0) {
            this._gainPoints(reward)
            this._updateStatsPanel()
          }
          // reward can be 0 even on a real repair once the per-round cap is
          // hit (see REPAIR_REWARD_CAP_PER_ROUND) - repair() itself already
          // guards "nothing to repair" (returns 0, leaves planks
          // untouched), so repairedWindowIndex being a valid index is the
          // real signal a repair happened, not reward > 0 alone.
          if (repairedWindowIndex !== -1) this._queueMultiplayerInteraction({ kind: 'repairWindow', windowIndex: repairedWindowIndex })
```

**Note on the reward-cap edge case above:** `repair()` returns `0` both when there was nothing to repair AND when a real repair happened but the round's reward cap was already hit - the plan reports the interaction either way (based on `repairedWindowIndex` being a valid index into an already-damaged window), since `BarricadeWindows.repair(w)`'s own internal guard (`if (!w || w.planks >= w.maxPlanks) return 0`) is what actually decides whether anything changed, and the host will run that exact same guard again safely when it processes the report - a report for a window that turned out to already be full by the time it's processed is a harmless no-op on the host's side.

- [ ] **Step 5: Report a vault open**

Already added directly in Task 3, Step 4 above (`this._queueMultiplayerInteraction({ kind: 'openVault' })`).

- [ ] **Step 6: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/game/Game.js
git commit -m "Add the interactions queue and chest/vault/window interact reporting (Phase 4)"
```

---

### Task 5: Render shared pickups on the guest and collect from them

**Files:**
- Modify: `src/game/Game.js` (a new `_renderSharedPickups` method, wired into `_tick()`)

**Interfaces:**
- Consumes: `PickupManager.sharedPickups`/`updateSharedPickups` (Task 2), `_queueMultiplayerInteraction` (Task 4).
- Produces: `Game._renderSharedPickups(pickupsSnapshot)` - Task 6's `_syncNetworkPlayerState` calls this from the guest branch.

- [ ] **Step 1: Add `_renderSharedPickups`, mirroring `_renderSharedZombies`' exact lazily-create/reuse/remove pattern**

Add this method right after `_renderSharedZombies` (added in Phase 3):

```js
  // Guest-side only - mirrors _renderSharedZombies' exact lazily-create/
  // reuse/remove-when-gone pattern, just for loot drops instead of
  // zombies. Reuses Pickups.js's own Pickup class directly (same visual-
  // building code every pickup already uses) rather than a parallel
  // rendering system.
  _renderSharedPickups(pickupsSnapshot) {
    const seenIds = new Set()
    for (const [idStr, state] of Object.entries(pickupsSnapshot)) {
      if (!state) continue
      const id = Number(idStr.slice(1))
      seenIds.add(id)
      const alreadyRendered = this.pickups.sharedPickups.some((p) => p.id === id)
      if (!alreadyRendered) {
        const pickup = new Pickup(state.type, state.x, state.z, true)
        pickup.id = id
        this.pickups.sharedPickups.push(pickup)
        this.scene.add(pickup.group)
      }
    }
    for (const pickup of [...this.pickups.sharedPickups]) {
      if (seenIds.has(pickup.id)) continue
      this.scene.remove(pickup.group)
      const idx = this.pickups.sharedPickups.indexOf(pickup)
      if (idx !== -1) this.pickups.sharedPickups.splice(idx, 1)
    }
  }
```

`Pickup` isn't exported from `Pickups.js` today (it's a module-private class) - add the export:

Find in `Pickups.js`:

```js
class Pickup {
```

Replace with:

```js
export class Pickup {
```

And add the import in `Game.js`. Find:

```js
import { PickupManager } from './Pickups.js'
```

Replace with:

```js
import { PickupManager, Pickup } from './Pickups.js'
```

- [ ] **Step 2: Call `updateSharedPickups` every guest tick and queue collections**

Find the same gated block from Task 3, Step 1:

```js
      if (!this._multiplayerSessionId || this._multiplayerIsHost) {
        this.pickups.update(dt, elapsed, playerPos, {
          onPickup: (type, label, isLoot) => this._onPickup(type, label, isLoot),
        }, companionLootPos, pickupRadiusMult)
      }
```

Replace with:

```js
      if (!this._multiplayerSessionId || this._multiplayerIsHost) {
        this.pickups.update(dt, elapsed, playerPos, {
          onPickup: (type, label, isLoot) => this._onPickup(type, label, isLoot),
        }, companionLootPos, pickupRadiusMult)
      } else {
        // Guest side - collect from whatever the host has broadcast
        // instead of a real local simulation. The pickup's own real type
        // (passed straight through by updateSharedPickups, since the
        // pickup is already spliced out of sharedPickups by the time this
        // fires - see Task 2) is enough to apply its effect immediately,
        // exactly like a solo pickup - only the "tell the host to stop
        // broadcasting this one" part needs a network round trip.
        this.pickups.updateSharedPickups(dt, elapsed, playerPos, (id, type) => {
          if (type) this._onPickup(type, type, true)
          this._queueMultiplayerInteraction({ kind: 'collectPickup', pickupId: id })
        })
      }
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/game/Pickups.js src/game/Game.js
git commit -m "Render and collect shared pickups on the guest side (Phase 4)"
```

---

### Task 6: Extend the sync endpoint for pickups/chests/vault/windows

**Files:**
- Modify: `api/multiplayer/sync.js` (full file additions alongside the existing zombies/worldEvents/remoteDamage handling)

**Interfaces:**
- Consumes: `pickups`/`chests`/`vaultOpened`/`windows` (host's outgoing broadcast, built in Task 7), `interactions` (any player's outgoing reports, built in Tasks 3-5).
- Produces: response gains `pickups`, `chests`, `vaultOpened`, `windows` (everyone gets these, broadcast like `zombies`/`worldEvents`) and `interactions` (host-only - the deliver-and-clear queue, same pattern `pendingHits` already uses).

- [ ] **Step 1: Accept the new request fields**

Find:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage } = req.body || {}
```

Replace with:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions } = req.body || {}
```

- [ ] **Step 2: Store the host's pickups/chests/vault/windows broadcasts**

Find:

```js
  if (isHost && Array.isArray(worldEvents) && worldEvents.length) {
```

Replace with:

```js
  if (isHost && Array.isArray(pickups)) {
    const pickupsById = {}
    for (const p of pickups) {
      // Same Firebase RTDB sparse-array precaution as world/zombies -
      // pickup ids are also a plain incrementing counter, so this is
      // exactly as likely to have gaps.
      pickupsById['p' + p.id] = { type: p.type, x: p.x, z: p.z }
    }
    await sessionRef.child('world/pickups').set(pickupsById)
  }

  if (isHost && Array.isArray(chests)) {
    // A plain array is safe here (no sparse-gap risk) - chest count and
    // order are fixed for the whole session, every index is always
    // present, never a candidate for Firebase's array-coercion gotcha.
    await sessionRef.child('world/chests').set(chests)
  }

  if (isHost && typeof vaultOpened === 'boolean') {
    await sessionRef.child('world/vaultOpened').set(vaultOpened)
  }

  if (isHost && Array.isArray(windows)) {
    await sessionRef.child('world/windows').set(windows)
  }

  if (isHost && Array.isArray(worldEvents) && worldEvents.length) {
```

- [ ] **Step 3: Store incoming interactions (from any player)**

Find:

```js
  if (!isHost && Array.isArray(hits) && hits.length) {
```

Replace with:

```js
  if (!isHost && Array.isArray(interactions) && interactions.length) {
    // Same shared-inbox-the-host-drains shape as pendingHits below - a
    // guest's own interactions never need delivering back to a specific
    // player (only the host ever needs to know "apply this to my real
    // managers"), so one unkeyed list is enough, unlike remoteDamage which
    // needed per-player delivery.
    const updates = {}
    for (const interaction of interactions) {
      const key = sessionRef.child('world/pendingInteractions').push().key
      updates[`world/pendingInteractions/${key}`] = interaction
    }
    await sessionRef.update(updates)
  }

  if (!isHost && Array.isArray(hits) && hits.length) {
```

- [ ] **Step 4: Deliver-and-clear pending interactions to the host**

Find:

```js
  let pendingHits = []
  if (isHost) {
    // Deliver-and-clear: not clearing would re-deliver the same hits
    // again on the host's next sync, double-applying the damage.
    const pendingSnapshot = await sessionRef.child('world/pendingHits').once('value')
    const pending = pendingSnapshot.val() || {}
    pendingHits = Object.values(pending)
    if (pendingHits.length) await sessionRef.child('world/pendingHits').remove()
  }
```

Replace with:

```js
  let pendingHits = []
  if (isHost) {
    // Deliver-and-clear: not clearing would re-deliver the same hits
    // again on the host's next sync, double-applying the damage.
    const pendingSnapshot = await sessionRef.child('world/pendingHits').once('value')
    const pending = pendingSnapshot.val() || {}
    pendingHits = Object.values(pending)
    if (pendingHits.length) await sessionRef.child('world/pendingHits').remove()
  }

  let pendingInteractions = []
  if (isHost) {
    const pendingInteractionsSnapshot = await sessionRef.child('world/pendingInteractions').once('value')
    const pendingInteractionsVal = pendingInteractionsSnapshot.val() || {}
    pendingInteractions = Object.values(pendingInteractionsVal)
    if (pendingInteractions.length) await sessionRef.child('world/pendingInteractions').remove()
  }
```

- [ ] **Step 5: Read back and include everything in the response**

Find:

```js
  const [stateSnapshot, playersSnapshot, zombiesSnapshot, eventsSnapshot] = await Promise.all([
    sessionRef.child('playerState').once('value'),
    sessionRef.child('players').once('value'),
    sessionRef.child('world/zombies').once('value'),
    sessionRef.child('world/events').once('value'),
  ])
```

Replace with:

```js
  const [stateSnapshot, playersSnapshot, zombiesSnapshot, eventsSnapshot, pickupsSnapshot, chestsSnapshot, vaultOpenedSnapshot, windowsSnapshot] = await Promise.all([
    sessionRef.child('playerState').once('value'),
    sessionRef.child('players').once('value'),
    sessionRef.child('world/zombies').once('value'),
    sessionRef.child('world/events').once('value'),
    sessionRef.child('world/pickups').once('value'),
    sessionRef.child('world/chests').once('value'),
    sessionRef.child('world/vaultOpened').once('value'),
    sessionRef.child('world/windows').once('value'),
  ])
```

Find:

```js
  res.status(200).json({ states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut })
}
```

Replace with:

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions,
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add api/multiplayer/sync.js
git commit -m "Extend the sync endpoint for pickups/chests/vault/windows (Phase 4)"
```

---

### Task 7: Wire it all through Multiplayer.js and Game.js

**Files:**
- Modify: `src/game/Multiplayer.js` (`syncPlayerState`)
- Modify: `src/game/Game.js` (`_syncNetworkPlayerState`)

**Interfaces:**
- Consumes: everything from Tasks 1-6.
- Produces: nothing new consumed by later tasks - Task 8 is deploy + verification only.

- [ ] **Step 1: Update `Multiplayer.js`'s return shape**

Find:

```js
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states, zombies, pendingHits, worldEvents, remoteDamage } = await _apiCall('sync', { sessionId, playerId, ...state })
  return { states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [] }
}
```

Replace with:

```js
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
  }
}
```

- [ ] **Step 2: Send the host's broadcasts and everyone's interactions; apply what comes back**

Find:

```js
      if (this.zombies.remoteDamageQueue.length) {
        payload.remoteDamage = this.zombies.remoteDamageQueue
        this.zombies.remoteDamageQueue = []
      }
    } else if (this._pendingZombieHits.length) {
      payload.hits = this._pendingZombieHits
      this._pendingZombieHits = []
    }
```

Replace with:

```js
      if (this.zombies.remoteDamageQueue.length) {
        payload.remoteDamage = this.zombies.remoteDamageQueue
        this.zombies.remoteDamageQueue = []
      }
      payload.pickups = this.pickups.pickups.map((p) => ({ id: p.id, type: p.type, x: p.group.position.x, z: p.group.position.z }))
      payload.chests = this.chests.chests.map((c) => ({ locked: c.locked, opened: c.opened }))
      payload.vaultOpened = this.vault.opened
      payload.windows = this.barricadeWindows.windows.map((w) => ({ planks: w.planks }))
    } else if (this._pendingZombieHits.length) {
      payload.hits = this._pendingZombieHits
      this._pendingZombieHits = []
    }
    if (this._pendingInteractions.length) {
      payload.interactions = this._pendingInteractions
      this._pendingInteractions = []
    }
```

Find:

```js
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage }) => {
```

Replace with:

```js
    import('./Multiplayer.js').then((Multiplayer) => {
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions }) => {
```

Find (still inside that same `.then(...)` callback, right after the existing `if (this._multiplayerIsHost) { ... } else { ... }` block that handles `pendingHits`/`_renderSharedZombies`):

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

Replace with:

```js
        if (this._multiplayerIsHost) {
          for (const hit of pendingHits) {
            const zombie = this.zombies.zombies.find((z) => z.id === hit.zombieId)
            if (zombie) zombie.onHit(hit.damage, { bypassShield: hit.bypassShield })
          }
          for (const interaction of interactions) {
            if (interaction.kind === 'collectPickup') {
              const pickup = this.pickups.pickups.find((p) => p.id === interaction.pickupId)
              if (pickup) {
                this.scene.remove(pickup.group)
                const idx = this.pickups.pickups.indexOf(pickup)
                if (idx !== -1) this.pickups.pickups.splice(idx, 1)
              }
            } else if (interaction.kind === 'openChest') {
              const chest = this.chests.chests[interaction.chestIndex]
              if (chest && !chest.opened && !chest.locked) chest.open()
            } else if (interaction.kind === 'openVault') {
              if (!this.vault.opened) {
                this.vault.open()
                this.pickups.spawnLootDrop('legendary_weapon', this.vault.x, this.vault.z + 1)
                if (Math.random() < VAULT_BONUS_ROLL_CHANCE) this.pickups.spawnLootDrop('rare_weapon', this.vault.x, this.vault.z - 1)
              }
            } else if (interaction.kind === 'repairWindow') {
              this.barricadeWindows.repair(this.barricadeWindows.windows[interaction.windowIndex])
            }
          }
        } else {
          this._renderSharedZombies(zombies, feetX, feetZ)
          this._renderSharedPickups(pickups)
          for (let i = 0; i < chests.length; i++) {
            const chest = this.chests.chests[i]
            const state = chests[i]
            if (!chest || !state) continue
            if (state.locked && !chest.locked) chest.lock()
            else if (!state.locked && chest.locked) chest.unlock()
            if (state.opened && !chest.opened) chest.open()
          }
          if (vaultOpened && !this.vault.opened) this.vault.open()
          for (let i = 0; i < windows.length; i++) {
            const window = this.barricadeWindows.windows[i]
            const state = windows[i]
            if (window && state) window.planks = state.planks
          }
        }
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds, no leftover references to the old (pre-Phase-4) `.then(({ states, zombies, pendingHits, worldEvents, remoteDamage })` destructuring shape anywhere in `Game.js`.

- [ ] **Step 4: Commit**

```bash
git add src/game/Multiplayer.js src/game/Game.js
git commit -m "Wire pickups/chests/vault/windows sync into the host and guest branches (Phase 4)"
```

---

### Task 8: Deploy and verify with two real browser sessions

**Files:**
- None (deploy + verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-7.

- [ ] **Step 1: Deploy to production**

```bash
npx vercel --prod --yes
```

- [ ] **Step 2: Two-browser Playwright verification**

Alternates touching both pages during any multi-second wait (background-tab throttling produced a false-negative result earlier tonight otherwise).

```python
from playwright.sync_api import sync_playwright
import time

def poll_both(check_fn, host_page, guest_page, timeout=180, interval=0.5):
    deadline = time.time() + timeout
    result = None
    while time.time() < deadline:
        host_page.evaluate("() => true")
        guest_page.evaluate("() => true")
        result = check_fn()
        if result:
            return result
        time.sleep(interval)
    return result

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    host_page = browser.new_page()
    guest_page = browser.new_page()

    host_page.goto('https://gayz.vercel.app', timeout=60000)
    poll_both(lambda: host_page.evaluate("() => !!window.__game"), host_page, guest_page, timeout=60)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    session_id = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'ZombieHost'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session:", session_id)

    guest_page.goto(f'https://gayz.vercel.app/?join={session_id}', timeout=60000)
    poll_both(lambda: guest_page.evaluate("() => !!window.__game"), host_page, guest_page, timeout=60)
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

    # --- Ground loot: force a drop near the guest, confirm the GUEST's own
    # ammo/inventory changes and it disappears from the host's own array ---
    guest_page.evaluate("""() => {
        window.__game.player.controls.object.position.set(80, window.__game.player.eyeHeight, 80)
    }""")
    host_page.evaluate("() => window.__game.pickups.spawnLootDrop('ammo', 80, 80)")
    host_pickup_count_before = host_page.evaluate("() => window.__game.pickups.pickups.length")
    print("host pickups after spawning near the guest:", host_pickup_count_before)

    guest_ammo_before = guest_page.evaluate("() => window.__game.weapons.current.ammoReserve")
    guest_ammo_changed = poll_both(
        lambda: guest_page.evaluate("() => window.__game.weapons.current.ammoReserve") != guest_ammo_before,
        host_page, guest_page, timeout=180
    )
    print("guest's own ammo changed from the drop:", guest_ammo_changed)

    host_pickup_count_after = poll_both(
        lambda: host_page.evaluate("() => window.__game.pickups.pickups.length") < host_pickup_count_before,
        host_page, guest_page, timeout=180
    )
    print("the drop disappeared from the host's own real array after the guest collected it:", host_pickup_count_after)

    # --- Chest: force one unlocked near the guest, guest opens it, confirm
    # the host's real ChestManager marks it opened and a second attempt
    # (from the host) yields nothing further ---
    host_page.evaluate("""() => {
        const chest = window.__game.chests.chests[0]
        chest.x = 80; chest.z = 85
        chest.group.position.set(80, 0, 85)
        chest.unlock()
    }""")
    poll_both(lambda: guest_page.evaluate("() => { const c = window.__game.chests.chests[0]; return c && !c.locked && !c.opened }"), host_page, guest_page, timeout=180)
    guest_page.evaluate("""() => {
        window.__game.player.controls.object.position.set(80, window.__game.player.eyeHeight, 85)
        window.__game.chests.nearbyChest = window.__game.chests.chests[0]
        const openedChestIndex = 0
        const loot = window.__game.chests.tryInteract()
        if (loot) {
            window.__game._onPickup(loot.type, loot.label, false, loot.count)
            window.__game._queueMultiplayerInteraction({ kind: 'openChest', chestIndex: openedChestIndex })
        }
    }""")
    host_chest_opened = poll_both(lambda: host_page.evaluate("() => window.__game.chests.chests[0].opened"), host_page, guest_page, timeout=180)
    print("host's real chest 0 marked opened after the guest's report:", host_chest_opened)

    # --- Barricade window: damage one, guest repairs it, confirm the
    # host's real plank count increases ---
    host_page.evaluate("""() => {
        const w = window.__game.barricadeWindows.windows[0]
        w.planks = w.maxPlanks - 2
    }""")
    host_planks_before = host_page.evaluate("() => window.__game.barricadeWindows.windows[0].planks")
    poll_both(lambda: guest_page.evaluate(f"() => window.__game.barricadeWindows.windows[0].planks") == host_planks_before, host_page, guest_page, timeout=180)
    guest_page.evaluate("""() => {
        const w = window.__game.barricadeWindows.windows[0]
        window.__game.barricadeWindows.repair(w)
        window.__game._queueMultiplayerInteraction({ kind: 'repairWindow', windowIndex: 0 })
    }""")
    host_planks_increased = poll_both(
        lambda: host_page.evaluate("() => window.__game.barricadeWindows.windows[0].planks") > host_planks_before,
        host_page, guest_page, timeout=180
    )
    print("host's real window 0 plank count increased after the guest's repair report:", host_planks_increased)

    browser.close()
```

Expected: `guest's own ammo changed from the drop`, `the drop disappeared from the host's own real array`, `host's real chest 0 marked opened`, and `host's real window 0 plank count increased` are all `True`.

- [ ] **Step 3: No commit needed** - this task deploys and verifies already-committed code from Tasks 1-7.

**Gaymi's test for this batch - needs your friend again:**
1. Start a run, invite your friend, both join the same session.
2. Kill a zombie together and look for its dropped loot - whoever walks up to it first should be the one who gets it (ammo/health/whatever it is added to *their* own inventory), and it should vanish from the other player's screen too, not just stay there as a "ghost" item.
3. Find an unlocked chest (glowing red) - have your friend open it. It should show as opened (green) on *your* screen too, and if you try to open it yourself afterward, nothing happens (no double loot).
4. Find a damaged barricade window (missing planks) - have your friend repair it. The plank count should go up on your screen too, not just theirs.
5. If you reach the Vault with a key, opening it should show as opened for both of you.

**Failure looks like:** a loot drop that only one of you can see or that both of you can somehow collect separately, a chest that shows different opened/locked state on each screen, or a barricade window whose plank count differs between the two of you.
