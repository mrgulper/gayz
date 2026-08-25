# Multiplayer Phase 5: Reward & Progress Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every one of the ~20 reward/progression systems a zombie kill touches (coins, points, XP, kill counts, achievements, quests, bounties, mastery, and more) correctly credit whichever player actually earned it in a shared session, add a 30-second anti-abuse guard, and build cross-player credit for Last Stand revival.

**Architecture:** `_onZombieKilled` splits into a world-effects half (always runs on the host, regardless of credit - loot spawns, hazard zones, obstacles, boss gauntlet, the killstreak airstrike) and a personal-rewards half (runs on whoever actually gets credit - relayed to a specific guest over the same per-recipient delivery `remoteDamage` already established, if that's who earned it). XP gems get the exact same host-broadcast/guest-collects treatment Phase 4 gave ground loot. Every guest-to-host report (collecting a gem, requesting an airstrike, becoming downed) reuses the existing `interactions` channel from Phase 4, now tagged server-side with the sender's id.

**Tech Stack:** Vite/vanilla JS, Three.js, Vercel serverless functions (Firebase Admin SDK proxy), Playwright for verification.

**Spec:** `docs/superpowers/specs/2026-08-25-multiplayer-phase5-reward-integrity-design.md`

## Global Constraints

- Personal vs world-state classification is fixed by the spec's own research - do not reclassify anything without a documented reason.
- Reuse existing channels wherever the shape already fits: `interactions` for every guest-to-host report (this phase adds `collectGem`, `killstreakAirstrike`, `becameDowned` to the existing `collectPickup`/`openChest`/`openVault`/`repairWindow` set), a new `killEvents` per-recipient list for every host-to-specific-guest push (kill rewards and Last Stand revival both use it, discriminated by `entry.kind`).
- `MIN_SESSION_TIME_FOR_REWARDS_MS = 30000` (30 seconds) - a guest credited with a kill less than this long after joining has that credit silently fall back to the host instead (never blocked, never an error).
- Any new object keyed by an incrementing counter (XP gem ids) uses the same non-numeric-prefixed-key precaution `world/zombies`/`world/pickups` already use.
- Apply Phase 4's own lesson learned: XP gems need the "already collected, ignore until it's gone from the snapshot" dedup guard built in from the start (see Phase 4's own fix for the bug this exact gap caused with ground loot).

---

### Task 1: Track which player landed the finishing blow

**Files:**
- Modify: `src/game/Zombie.js` (the real, non-network `onHit` branch)
- Modify: `src/game/ZombieManager.js` (the death-detection block's `onZombieKilled(...)` call)
- Modify: `src/game/Game.js` (`_syncNetworkPlayerState`'s `pendingHits` processing loop)

**Interfaces:**
- Produces: `Zombie.prototype._lastHitFromPlayerId` (a real instance field, `null` = the host's own local shot, a player id string = that guest's shot) - Task 4 reads `zombie._lastHitFromPlayerId` via the `onZombieKilled` callback's new trailing argument.

- [ ] **Step 1: Track the field on every real hit**

Find in `Zombie.js`:

```js
    if (this.state !== 'alive' && this.state !== 'popping') return
    // Shielded type: non-melee hits drain the shield pool first and never
    // touch health while it holds; melee (see lastHitWeaponId, set by
    // WeaponSystem._fire right before every onHit call) skips it entirely -
```

Replace with:

```js
    if (this.state !== 'alive' && this.state !== 'popping') return
    // Phase 5 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase5-reward-integrity-design.md) -
    // overwritten on every real hit regardless of source, so whichever
    // player's shot most recently reduced this zombie's health is who
    // gets credited if this hit is the one that kills it. null means the
    // host's own local shot (every existing onHit call site already omits
    // fromPlayerId, so this is the correct default with zero other
    // changes needed anywhere else in this file).
    this._lastHitFromPlayerId = opts.fromPlayerId ?? null
    // Shielded type: non-melee hits drain the shield pool first and never
    // touch health while it holds; melee (see lastHitWeaponId, set by
    // WeaponSystem._fire right before every onHit call) skips it entirely -
```

- [ ] **Step 2: Pass it through to the death-detection callback**

Find in `ZombieManager.js`:

```js
        if (onZombieKilled) onZombieKilled(zombie.config.id, zombie.lastHitWeaponId, zombie.group.position.x, zombie.group.position.z, zombie.isElite, !!zombie.isWandering, !!zombie.isGolden, !!zombie.fleeing, !!zombie.isCarrier)
```

Replace with:

```js
        if (onZombieKilled) onZombieKilled(zombie.config.id, zombie.lastHitWeaponId, zombie.group.position.x, zombie.group.position.z, zombie.isElite, !!zombie.isWandering, !!zombie.isGolden, !!zombie.fleeing, !!zombie.isCarrier, zombie._lastHitFromPlayerId ?? null)
```

- [ ] **Step 3: Thread `fromPlayerId` from a guest's reported hit into `onHit`**

Find in `Game.js`:

```js
          for (const hit of pendingHits) {
            const zombie = this.zombies.zombies.find((z) => z.id === hit.zombieId)
            if (zombie) zombie.onHit(hit.damage, { bypassShield: hit.bypassShield })
          }
```

Replace with:

```js
          for (const hit of pendingHits) {
            const zombie = this.zombies.zombies.find((z) => z.id === hit.zombieId)
            if (zombie) zombie.onHit(hit.damage, { bypassShield: hit.bypassShield, fromPlayerId: hit.fromPlayerId })
          }
```

(`hit.fromPlayerId` already exists on every pending hit - `api/multiplayer/sync.js`'s existing `pendingHits` storage has set it, from the server-trusted caller id, since Phase 3. This step is the first time anything actually reads it.)

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/game/Zombie.js src/game/ZombieManager.js src/game/Game.js
git commit -m "Track which player landed the finishing blow on a shared zombie kill (Phase 5)"
```

---

### Task 2: Expose join time and tag interactions with their sender

**Files:**
- Modify: `api/multiplayer/sync.js`

**Interfaces:**
- Produces: `states[playerId].joinedAt` (added to the existing response, read from the `players` node sync.js already fetches) - Task 3 reads this for the anti-abuse guard. Every stored interaction gains `fromPlayerId` - Task 10 needs this for `becameDowned`.

- [ ] **Step 1: Include `joinedAt` in each player's state**

Find:

```js
  for (const [otherId, state] of Object.entries(allStates)) {
    if (otherId === playerId) continue
    if (now - state.updatedAt > STALE_MS) continue
    states[otherId] = { ...state, nickname: allPlayers[otherId]?.nickname || 'Player' }
  }
```

Replace with:

```js
  for (const [otherId, state] of Object.entries(allStates)) {
    if (otherId === playerId) continue
    if (now - state.updatedAt > STALE_MS) continue
    // Phase 5 multiplayer - the host uses this for the anti-abuse guard
    // (a player who joined less than 30s ago has their kill credit fall
    // back to the host instead of themselves). allPlayers already has
    // this - api/multiplayer/join.js and create.js both record it at
    // join/create time - this is the first read of it.
    states[otherId] = { ...state, nickname: allPlayers[otherId]?.nickname || 'Player', joinedAt: allPlayers[otherId]?.joinedAt || 0 }
  }
```

- [ ] **Step 2: Tag every stored interaction with who sent it**

Find:

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
```

Replace with:

```js
  if (!isHost && Array.isArray(interactions) && interactions.length) {
    // Same shared-inbox-the-host-drains shape as pendingHits below - a
    // guest's own interactions never need delivering back to a specific
    // player (only the host ever needs to know "apply this to my real
    // managers"), so one unkeyed list is enough, unlike remoteDamage which
    // needed per-player delivery. fromPlayerId (Phase 5) lets a handler
    // that DOES need to know who sent it (becameDowned) find out, while
    // every existing kind that doesn't need it just ignores the extra field.
    const updates = {}
    for (const interaction of interactions) {
      const key = sessionRef.child('world/pendingInteractions').push().key
      updates[`world/pendingInteractions/${key}`] = { ...interaction, fromPlayerId: playerId }
    }
    await sessionRef.update(updates)
  }
```

- [ ] **Step 3: Commit**

```bash
git add api/multiplayer/sync.js
git commit -m "Expose join time and tag interactions with their sender (Phase 5)"
```

---

### Task 3: Resolve kill credit with the anti-abuse guard

**Files:**
- Modify: `src/game/Game.js` (`_renderRemotePlayers`, a new helper method)

**Interfaces:**
- Consumes: `state.joinedAt` (Task 2).
- Produces: `Game.prototype._resolveKillCreditPlayerId(rawCreditPlayerId)` - Task 4's `_onZombieKilled` dispatcher calls this.

- [ ] **Step 1: Track every other connected player's join time**

Find in `_renderRemotePlayers`:

```js
  _renderRemotePlayers(states) {
    const seenIds = new Set()
    // Phase 3c (docs/superpowers/specs/2026-08-25-multiplayer-phase3c-remaining-zombies-design.md) -
    // rebuilt fresh every call, same as the rendering loop below - this is
    // what lets the host's zombie AI (see ZombieManager.update's new
    // otherPlayers param) know where every OTHER connected player actually
    // is, not just the host's own position.
    this._otherPlayerPositions = []
    for (const [id, state] of Object.entries(states)) {
      seenIds.add(id)
      let body = this._remotePlayerBodies.get(id)
      if (!body) {
        body = new MinecraftPlayerBody(this.scene)
        this._remotePlayerBodies.set(id, body)
      }
      body.update(state.x, state.y, state.z, state.rotY, true)
      body.setNickname(state.nickname || 'Player')
      this._otherPlayerPositions.push({ playerId: id, x: state.x, z: state.z })
    }
```

Replace with:

```js
  _renderRemotePlayers(states) {
    const seenIds = new Set()
    // Phase 3c (docs/superpowers/specs/2026-08-25-multiplayer-phase3c-remaining-zombies-design.md) -
    // rebuilt fresh every call, same as the rendering loop below - this is
    // what lets the host's zombie AI (see ZombieManager.update's new
    // otherPlayers param) know where every OTHER connected player actually
    // is, not just the host's own position.
    this._otherPlayerPositions = []
    // Phase 5 multiplayer - the anti-abuse guard's own source of truth for
    // "how long has this guest actually been in the session" (server-
    // recorded, not guest-claimed - see api/multiplayer/sync.js's own
    // comment on this field).
    for (const [id, state] of Object.entries(states)) {
      seenIds.add(id)
      let body = this._remotePlayerBodies.get(id)
      if (!body) {
        body = new MinecraftPlayerBody(this.scene)
        this._remotePlayerBodies.set(id, body)
      }
      body.update(state.x, state.y, state.z, state.rotY, true)
      body.setNickname(state.nickname || 'Player')
      this._otherPlayerPositions.push({ playerId: id, x: state.x, z: state.z })
      this._otherPlayerJoinedAt.set(id, state.joinedAt || 0)
    }
```

- [ ] **Step 2: Initialize the new map**

Find in the constructor:

```js
    this._otherPlayerPositions = [] // {playerId, x, z}[] - every OTHER connected player's last-known position, host-side AI targeting input (Phase 3c)
```

Replace with:

```js
    this._otherPlayerPositions = [] // {playerId, x, z}[] - every OTHER connected player's last-known position, host-side AI targeting input (Phase 3c)
    this._otherPlayerJoinedAt = new Map() // playerId -> server-recorded join timestamp (ms), Phase 5's anti-abuse guard input
```

- [ ] **Step 3: Add the resolver method**

Find in the constructor, near the other multiplayer fields (any reasonable nearby line is fine - e.g. right after `_otherPlayerJoinedAt`'s own initialization above), and separately add this new method anywhere among the class's other small helper methods (e.g. right after `_queueMultiplayerInteraction`):

```js
  // Phase 5 multiplayer - the host calls this once per shared kill to turn
  // the raw "who last hit this zombie" id into a real decision: null (or
  // an id that isn't currently a connected player - they may have just
  // disconnected) falls back to the host; a guest who joined less than
  // MIN_SESSION_TIME_FOR_REWARDS_MS ago also falls back to the host (the
  // anti-abuse guard - see this plan's own Global Constraints). The host
  // itself never needs this guard (it created or has always been in its
  // own session), so this only ever restricts a NON-null id.
  _resolveKillCreditPlayerId(rawCreditPlayerId) {
    if (rawCreditPlayerId === null) return null
    const joinedAt = this._otherPlayerJoinedAt.get(rawCreditPlayerId)
    if (joinedAt === undefined) return null
    if (Date.now() - joinedAt < MIN_SESSION_TIME_FOR_REWARDS_MS) return null
    return rawCreditPlayerId
  }
```

Add the constant near this project's other multiplayer-related module-level constants (e.g. alongside `VAULT_BONUS_ROLL_CHANCE` or any other top-level `const` in `Game.js`):

```js
// Phase 5 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase5-reward-integrity-design.md) -
// a guest credited with a kill this soon after joining has that credit
// silently fall back to the host instead - the anti-abuse guard the
// original master multiplayer doc called out, without needing any real
// anti-cheat validation.
const MIN_SESSION_TIME_FOR_REWARDS_MS = 30000
```

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "Add the kill-credit resolver and 30-second anti-abuse guard (Phase 5)"
```

---

### Task 4: Split `_onZombieKilled` into world-effects and personal-rewards

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `_resolveKillCreditPlayerId` (Task 3).
- Produces: `_onZombieKilledWorldEffects(zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing, isCarrier)` (returns `waveCleared: boolean`) and `_onZombieKilledPersonalRewards(zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing, isCarrier, waveCleared)` - Task 5 relays the latter to a credited guest when needed. `_onZombieKilled` itself becomes the dispatcher ZombieManager's callback still targets unchanged.

This task's replacement is large - read it in full before starting, since the "Find" block below is the *entire current method body* and needs to be replaced with three separate methods in one edit.

- [ ] **Step 1: Replace the whole method**

Find (the complete current `_onZombieKilled`, exactly as it stands before this task):

```js
  _onZombieKilled(zombieTypeId, weaponId, x, z, isElite, isWandering = false, isGolden = false, wasFleeing = false, isCarrier = false) {
    if (this.settings.bloodEffectsEnabled) this.decals.spawnPuddle(x, z)
    if (weaponId === 'melee') this._spawnMeleeKillFlash(x, z)
    // Environmental melee kills (batch 8 feature) - a melee kill landed
    // inside an active hazard zone (gas/acid/web/toxic spread/radiation)
    // rewards using the environment as a weapon, same spirit as shoving a
    // zombie into a real hazard - reuses the existing hazard-zone system
    // rather than needing a new spikes/traffic mechanic of its own.
    if (weaponId === 'melee' && this.hazardZones.some((zone) => Math.hypot(zone.x - x, zone.z - z) <= zone.radius)) {
      this._gainPoints(ENVIRONMENTAL_MELEE_KILL_POINTS)
      this._showLoreToast(t('toastEnvironmentalKill'))
    }
    // Golden Zombie bonus (see _maybeSpawnGoldenZombie) - on top of, not
    // instead of, every other reward this kill already earns below.
    if (isGolden) {
      this.coins += GOLDEN_ZOMBIE_COIN_BONUS
      this._showCoinPopup(GOLDEN_ZOMBIE_COIN_BONUS)
      this._showLoreToast(t('goldenZombieJackpot', { n: GOLDEN_ZOMBIE_COIN_BONUS }))
    }
    // Caught the last, fleeing zombie of a Round Mode wave (see
    // _checkRoundModeSpecialEvents) - a small capstone bonus/flavor line
    // for finishing what would otherwise have gotten away.
    if (wasFleeing) this._showLoreToast(t('caughtFleeingZombie'))
    this.rollingQuests.recordKill()
    this.kills += 1
    this.killStreak += 1
    if (this.killStreak > this.peakKillStreakThisRun) this.peakKillStreakThisRun = this.killStreak
    this._checkKillstreakReward()
    this.totalKills += 1
    this.killCountsThisRun[weaponId] = (this.killCountsThisRun[weaponId] || 0) + 1
    this._checkWeeklyChallengeProgress()
    // Last Stand - clawing back up under your own power, not a passive
    // timer-only wait (see _tryLastStand/downedKillsNeeded).
    if (this.playerDowned) {
      this.downedKillsNeeded -= 1
      if (this.downedKillsNeeded <= 0) this._reviveFromLastStand()
    }
    this.recentKillTimestamps.push(performance.now())
    // Corpse pile-up (see CORPSE_PILE_RADIUS's own comment) - capped so a
    // long run can't grow this array unbounded.
    this.recentKillSpots.push({ x, z, at: performance.now() })
    if (this.recentKillSpots.length > CORPSE_PILE_MAX_TRACKED) this.recentKillSpots.shift()
    // Wandering horde members (see ZombieManager's _maybeSpawnWanderingHorde)
    // are worth intercepting for their own sake rather than just background
    // population you happen to run into - a small guaranteed bonus per kill,
    // on top of (not instead of) the normal 25%-chance points roll below.
    if (isWandering) {
      this._gainPoints(5)
      this._updateStatsPanel()
    }
    const lootMult = (this.settings.mutators.lootRush ? 2 : 1) * this.difficulty.lootMult * (this.perfectWeather ? PERFECT_WEATHER_LOOT_BONUS_MULT : 1)
    this.xpGems.spawn(x, z, (isElite ? 4 : 1) * lootMult)
    if (isElite) {
      this.eliteKills += 1
      if (this.eliteKills >= 5) {
        this.achievements.unlock('elite_hunter')
        // Milestone cosmetic unlock - same free-grant shape as
        // bestiary_master's obsidian skin below, just a different
        // achievement/skin pairing.
        if (!this.ownedSkins.has('crimson')) {
          this.ownedSkins.add('crimson')
          this._showLoreToast(t('crimsonSkinUnlocked'))
        }
      }
    }
    // Elite carrier zombies (batch 7 feature) - a guaranteed rare/legendary
    // weapon drop, independent of (on top of) the every-10th-kill and
    // random field-power-up drops below.
    if (isCarrier) {
      this.pickups.spawnLootDrop(Math.random() < 0.3 ? 'legendary_weapon' : 'rare_weapon', x, z)
      this._showLoreToast(t('toastCarrierDropped'))
    }
    if (weaponId === 'vehicle') this.achievements.unlock('road_kill')
    this._registerComboKill()
    if (this.kills % 10 === 0) {
      this._companionBark('killStreak')
      // Guaranteed loot every 10th kill - replaces the old flat per-kill
      // random-chance drop so supplies come from actually fighting instead
      // of the world just handing them out.
      this.pickups.spawnKillDrop(x, z)
    }
    // Field power-ups - independent of (not instead of) the guaranteed
    // every-10th-kill drop above, so they can land on any kill.
    if (Math.random() < POWERUP_DROP_CHANCE) {
      const powerupType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
      this.pickups.spawnLootDrop(powerupType, x, z)
    }
    this.achievements.unlock('first_blood')
    if (this.totalKills >= 100) this.achievements.unlock('centurion')
    if (zombieTypeId === 'fester') {
      this._spawnHazardZone('gas', x, z)
      if (this._multiplayerIsHost) this._pendingWorldEvents.push({ id: 'h' + (this._nextHazardEventId++), type: 'gas', x, z })
    }
    if (this.activeBounty && this.activeBounty.id === 'clear_location') {
      const dist = Math.hypot(x - this.activeBounty.locationX, z - this.activeBounty.locationZ)
      if (dist <= CLEAR_LOCATION_RADIUS) this._checkBountyProgress('clear_location', 1)
    }
    if (zombieTypeId === 'brute' && weaponId === 'melee') this.achievements.unlock('brute_knife')
    if (zombieTypeId === 'screamer') this._checkBountyProgress('kill_screamers', 1)
    this._checkTraderQuestKill()
    if (weaponId === 'melee') this._checkBountyProgress('melee_kills', 1)
    if (weaponId === 'minigun') {
      this.killCountsByWeapon.minigun = (this.killCountsByWeapon.minigun || 0) + 1
      if (this.killCountsByWeapon.minigun >= 50) {
        this.achievements.unlock('meat_grinder')
        if (!this.ownedSkins.has('cobalt')) {
          this.ownedSkins.add('cobalt')
          this._showLoreToast(t('cobaltSkinUnlocked'))
        }
      }
    }
    this._trackWeaponMastery(weaponId)
    this._checkWeaponChallenge(weaponId)
    if (Math.random() < 0.25) {
      const doublePointsMult = this.doublePointsUntil && performance.now() < this.doublePointsUntil ? 2 : 1
      // Rounded here (not just at display) since _comboMultiplier() returns
      // a fractional value - without this, points drifts into long decimals.
      this._gainPoints(Math.round((2 + Math.floor(Math.random() * 4)) * lootMult * doublePointsMult * this._comboMultiplier()))
      this._updateStatsPanel()
    }

    // Coins: a separate, guaranteed-every-kill currency (unlike points'
    // 25%-chance drop) spent exclusively in the Coin Shop - see CoinShop.js.
    let coinsEarned
    if (BOSS_TIER_IDS.has(zombieTypeId)) {
      coinsEarned = 300 + Math.floor(Math.random() * 201)
      this._triggerBossKillcam()
      if (!this.narrativeStats.bossEpitaphsSeen.includes(zombieTypeId)) {
        this.narrativeStats.bossEpitaphsSeen.push(zombieTypeId)
        saveNarrativeStats(this.narrativeStats)
        this._showLoreToast(t(BOSS_EPITAPH_KEYS[zombieTypeId]))
      }
    } else if (isElite) {
      coinsEarned = 20 + Math.floor(Math.random() * 181)
    } else {
      coinsEarned = 10 + Math.floor(Math.random() * 91)
    }
    // Kill Feed (see _pushKillFeed) - one entry per kill at most, picked by
    // priority (boss > big combo > elite > melee) so a kill that qualifies
    // for several categories at once doesn't spam multiple stacked entries.
    if (BOSS_TIER_IDS.has(zombieTypeId)) {
      this._pushKillFeed('BOSS DOWN', 'boss')
      this._flagHighlightMoment('Boss down')
    } else if (this.comboCount >= COMBO_TIER3_THRESHOLD) {
      this._pushKillFeed(`${this.comboCount}x COMBO`, 'combo')
      this._flagHighlightMoment(`${this.comboCount}x combo`)
    } else if (isElite) {
      this._pushKillFeed('Elite eliminated', 'elite')
    } else if (weaponId === 'melee') {
      this._pushKillFeed('Melee finish')
    }
    // Industrial Siren bonus (Interactive World batch, see
    // _pullSirenLever) - applied here so the popup itself already reflects
    // the boosted total, same "multiply before display" approach
    // doublePointsMult above already uses for points.
    if (this.sirenLootBonusUntil && performance.now() < this.sirenLootBonusUntil) {
      coinsEarned = Math.round(coinsEarned * SIREN_BONUS_LOOT_MULT)
    }
    this.coins += coinsEarned
    this._showCoinPopup(coinsEarned)
    this._updateStatsPanel()
    this._maybeDropObstacle(x, z)

    // Boss Gauntlet mutator - the next boss walks in immediately on this
    // one's death, no waiting for the next night boundary. Checked
    // separately from the BOSS_TIER_IDS branch above (which only covers
    // colossus/titan for the epitaph/killcam reward) since _spawnBoss's own
    // alternation also treats broodmother as an equal boss slot.
    if (this.settings.mutators.bossGauntlet && BOSS_GAUNTLET_TYPE_IDS.has(zombieTypeId)) {
      this.zombies.spawnBossGauntletNext()
    }

    if (!this.bestiaryEncountered.has(zombieTypeId)) {
      this.bestiaryEncountered.add(zombieTypeId)
      saveEncountered(this.bestiaryEncountered)
      if (this.bestiaryEncountered.size >= Object.keys(ZOMBIE_TYPES).length) {
        this.achievements.unlock('bestiary_master')
        if (!this.ownedSkins.has('obsidian')) {
          this.ownedSkins.add('obsidian')
          this._showLoreToast(t('obsidianSkinUnlocked'))
        }
      }
    }

    // Guaranteed boss loot - on top of the normal chance-based ammo drop,
    // not instead of it.
    if (zombieTypeId === 'colossus') this.pickups.spawnLootDrop('extended_mag', x, z)

    // Wave-Clear Finisher Cam - reuses the exact same killcamUntil slow-mo/
    // zoom mechanism _triggerBossKillcam already drives, just triggered by
    // "nothing left alive" instead of "that alive thing was a boss" - boss
    // kills are excluded here since _triggerBossKillcam above already fired
    // for those, and stacking both would just restart the same effect.
    if (!BOSS_TIER_IDS.has(zombieTypeId) && this.zombies.zombies.filter((z) => z.state === 'alive').length === 0) {
      this._triggerWaveClearedCam()
    }
  }
```

Replace with:

```js
  // Phase 5 multiplayer - the dispatcher every ZombieManager death-
  // detection callback still targets, unchanged from the outside. Always
  // runs the world-effects half locally (only the host's own
  // zombies.update() ever calls this at all, per Phase 3's own gating, so
  // "locally" here always means "on the host"), then either runs the
  // personal-rewards half locally too (this was the host's own kill, or
  // the anti-abuse guard fell back to the host) or relays it to whichever
  // guest actually earned it.
  _onZombieKilled(zombieTypeId, weaponId, x, z, isElite, isWandering = false, isGolden = false, wasFleeing = false, isCarrier = false, rawCreditPlayerId = null) {
    const waveCleared = this._onZombieKilledWorldEffects(zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing, isCarrier)
    const creditPlayerId = this._resolveKillCreditPlayerId(rawCreditPlayerId)
    if (creditPlayerId === null) {
      this._onZombieKilledPersonalRewards(zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing, isCarrier, waveCleared)
    } else {
      this._queueKillEvent(creditPlayerId, { kind: 'kill', zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing, isCarrier, waveCleared })
    }
  }

  // World-state side effects - always run here (the host), regardless of
  // which player actually gets credited for the kill, since only the
  // host's own instances of PickupManager/XpGemManager/ZombieManager/etc.
  // are the real ones anyone else's game ever sees. Returns whether this
  // kill cleared the last alive zombie, since _onZombieKilledPersonalRewards
  // (which may run on a GUEST, whose own this.zombies.zombies is never the
  // real simulated array - see Phase 3/4's own gating) can't safely
  // recompute that itself.
  _onZombieKilledWorldEffects(zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing, isCarrier) {
    if (this.settings.bloodEffectsEnabled) this.decals.spawnPuddle(x, z)
    if (weaponId === 'melee') this._spawnMeleeKillFlash(x, z)
    // Last Stand - clawing back up under your own power, not a passive
    // timer-only wait (see _tryLastStand/downedKillsNeeded). The host's own
    // downed state (unchanged from before this phase) plus every tracked
    // guest's downed state (Task 10) both decrement on every kill,
    // regardless of who's credited - a teammate's kill should be able to
    // save you, per Gaymi's explicit choice.
    if (this.playerDowned) {
      this.downedKillsNeeded -= 1
      if (this.downedKillsNeeded <= 0) this._reviveFromLastStand()
    }
    // Corpse pile-up (see CORPSE_PILE_RADIUS's own comment) - capped so a
    // long run can't grow this array unbounded.
    this.recentKillSpots.push({ x, z, at: performance.now() })
    if (this.recentKillSpots.length > CORPSE_PILE_MAX_TRACKED) this.recentKillSpots.shift()
    const lootMult = (this.settings.mutators.lootRush ? 2 : 1) * this.difficulty.lootMult * (this.perfectWeather ? PERFECT_WEATHER_LOOT_BONUS_MULT : 1)
    // XP gem spawning is world-state (only the host's own XpGemManager
    // broadcasts - see Task 7/8) even though collecting one is a personal
    // reward, same split ground loot already has.
    this.xpGems.spawn(x, z, (isElite ? 4 : 1) * lootMult)
    // Elite carrier zombies (batch 7 feature) - a guaranteed rare/legendary
    // weapon drop, independent of (on top of) the every-10th-kill and
    // random field-power-up drops below.
    if (isCarrier) this.pickups.spawnLootDrop(Math.random() < 0.3 ? 'legendary_weapon' : 'rare_weapon', x, z)
    // Guaranteed loot every 10th shared-session kill - a dedicated
    // host-owned counter, not this.kills (which is now a personal stat
    // that may live on a guest's own client, invisible to this always-
    // host method).
    this._sharedKillCountForLoot = (this._sharedKillCountForLoot || 0) + 1
    if (this._sharedKillCountForLoot % 10 === 0) this.pickups.spawnKillDrop(x, z)
    // Field power-ups - independent of (not instead of) the guaranteed
    // every-10th-kill drop above, so they can land on any kill.
    if (Math.random() < POWERUP_DROP_CHANCE) {
      const powerupType = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
      this.pickups.spawnLootDrop(powerupType, x, z)
    }
    if (zombieTypeId === 'fester') {
      this._spawnHazardZone('gas', x, z)
      if (this._multiplayerIsHost) this._pendingWorldEvents.push({ id: 'h' + (this._nextHazardEventId++), type: 'gas', x, z })
    }
    this._maybeDropObstacle(x, z)
    // Boss Gauntlet mutator - the next boss walks in immediately on this
    // one's death, no waiting for the next night boundary. Checked
    // separately from the boss-tier coin/killcam reward (personal half)
    // since _spawnBoss's own alternation also treats broodmother as an
    // equal boss slot.
    if (this.settings.mutators.bossGauntlet && BOSS_GAUNTLET_TYPE_IDS.has(zombieTypeId)) {
      this.zombies.spawnBossGauntletNext()
    }
    // Guaranteed boss loot - on top of the normal chance-based ammo drop,
    // not instead of it.
    if (zombieTypeId === 'colossus') this.pickups.spawnLootDrop('extended_mag', x, z)
    // Wave-Clear Finisher Cam's own trigger condition - computed here
    // (where this.zombies.zombies is always the real array) and handed
    // back as a flag for the personal half (which may run on a guest,
    // where that array is never real) to act on instead of re-deriving it.
    return !BOSS_TIER_IDS.has(zombieTypeId) && this.zombies.zombies.filter((z) => z.state === 'alive').length === 0
  }

  // Personal rewards - runs on whichever client actually gets credit for
  // the kill (the host's own client if this was its kill, or a specific
  // guest's client via a relayed killEvent - see _onZombieKilled/
  // _syncNetworkPlayerState). Every line here mutates only "my own"
  // client-local state (coins, achievements, quest progress, etc.) -
  // nothing here may read this.zombies/this.pickups/this.chests/etc.
  // directly, since those are only the real, shared instances on the host.
  _onZombieKilledPersonalRewards(zombieTypeId, weaponId, x, z, isElite, isWandering, isGolden, wasFleeing, isCarrier, waveCleared) {
    // Environmental melee kills (batch 8 feature) - a melee kill landed
    // inside an active hazard zone (gas/acid/web/toxic spread/radiation)
    // rewards using the environment as a weapon, same spirit as shoving a
    // zombie into a real hazard - reuses the existing hazard-zone system
    // rather than needing a new spikes/traffic mechanic of its own.
    if (weaponId === 'melee' && this.hazardZones.some((zone) => Math.hypot(zone.x - x, zone.z - z) <= zone.radius)) {
      this._gainPoints(ENVIRONMENTAL_MELEE_KILL_POINTS)
      this._showLoreToast(t('toastEnvironmentalKill'))
    }
    // Golden Zombie bonus (see _maybeSpawnGoldenZombie) - on top of, not
    // instead of, every other reward this kill already earns below.
    if (isGolden) {
      this.coins += GOLDEN_ZOMBIE_COIN_BONUS
      this._showCoinPopup(GOLDEN_ZOMBIE_COIN_BONUS)
      this._showLoreToast(t('goldenZombieJackpot', { n: GOLDEN_ZOMBIE_COIN_BONUS }))
    }
    // Caught the last, fleeing zombie of a Round Mode wave (see
    // _checkRoundModeSpecialEvents) - a small capstone bonus/flavor line
    // for finishing what would otherwise have gotten away.
    if (wasFleeing) this._showLoreToast(t('caughtFleeingZombie'))
    this.rollingQuests.recordKill()
    this.kills += 1
    this.killStreak += 1
    if (this.killStreak > this.peakKillStreakThisRun) this.peakKillStreakThisRun = this.killStreak
    this._checkKillstreakReward()
    this.totalKills += 1
    this.killCountsThisRun[weaponId] = (this.killCountsThisRun[weaponId] || 0) + 1
    this._checkWeeklyChallengeProgress()
    this.recentKillTimestamps.push(performance.now())
    // Wandering horde members (see ZombieManager's _maybeSpawnWanderingHorde)
    // are worth intercepting for their own sake rather than just background
    // population you happen to run into - a small guaranteed bonus per kill,
    // on top of (not instead of) the normal 25%-chance points roll below.
    if (isWandering) {
      this._gainPoints(5)
      this._updateStatsPanel()
    }
    const lootMult = (this.settings.mutators.lootRush ? 2 : 1) * this.difficulty.lootMult * (this.perfectWeather ? PERFECT_WEATHER_LOOT_BONUS_MULT : 1)
    if (isElite) {
      this.eliteKills += 1
      if (this.eliteKills >= 5) {
        this.achievements.unlock('elite_hunter')
        // Milestone cosmetic unlock - same free-grant shape as
        // bestiary_master's obsidian skin below, just a different
        // achievement/skin pairing.
        if (!this.ownedSkins.has('crimson')) {
          this.ownedSkins.add('crimson')
          this._showLoreToast(t('crimsonSkinUnlocked'))
        }
      }
    }
    if (isCarrier) this._showLoreToast(t('toastCarrierDropped'))
    if (weaponId === 'vehicle') this.achievements.unlock('road_kill')
    this._registerComboKill()
    if (this.kills % 10 === 0) this._companionBark('killStreak')
    this.achievements.unlock('first_blood')
    if (this.totalKills >= 100) this.achievements.unlock('centurion')
    if (this.activeBounty && this.activeBounty.id === 'clear_location') {
      const dist = Math.hypot(x - this.activeBounty.locationX, z - this.activeBounty.locationZ)
      if (dist <= CLEAR_LOCATION_RADIUS) this._checkBountyProgress('clear_location', 1)
    }
    if (zombieTypeId === 'brute' && weaponId === 'melee') this.achievements.unlock('brute_knife')
    if (zombieTypeId === 'screamer') this._checkBountyProgress('kill_screamers', 1)
    this._checkTraderQuestKill()
    if (weaponId === 'melee') this._checkBountyProgress('melee_kills', 1)
    if (weaponId === 'minigun') {
      this.killCountsByWeapon.minigun = (this.killCountsByWeapon.minigun || 0) + 1
      if (this.killCountsByWeapon.minigun >= 50) {
        this.achievements.unlock('meat_grinder')
        if (!this.ownedSkins.has('cobalt')) {
          this.ownedSkins.add('cobalt')
          this._showLoreToast(t('cobaltSkinUnlocked'))
        }
      }
    }
    this._trackWeaponMastery(weaponId)
    this._checkWeaponChallenge(weaponId)
    if (Math.random() < 0.25) {
      const doublePointsMult = this.doublePointsUntil && performance.now() < this.doublePointsUntil ? 2 : 1
      // Rounded here (not just at display) since _comboMultiplier() returns
      // a fractional value - without this, points drifts into long decimals.
      this._gainPoints(Math.round((2 + Math.floor(Math.random() * 4)) * lootMult * doublePointsMult * this._comboMultiplier()))
      this._updateStatsPanel()
    }

    // Coins: a separate, guaranteed-every-kill currency (unlike points'
    // 25%-chance drop) spent exclusively in the Coin Shop - see CoinShop.js.
    let coinsEarned
    if (BOSS_TIER_IDS.has(zombieTypeId)) {
      coinsEarned = 300 + Math.floor(Math.random() * 201)
      this._triggerBossKillcam()
      if (!this.narrativeStats.bossEpitaphsSeen.includes(zombieTypeId)) {
        this.narrativeStats.bossEpitaphsSeen.push(zombieTypeId)
        saveNarrativeStats(this.narrativeStats)
        this._showLoreToast(t(BOSS_EPITAPH_KEYS[zombieTypeId]))
      }
    } else if (isElite) {
      coinsEarned = 20 + Math.floor(Math.random() * 181)
    } else {
      coinsEarned = 10 + Math.floor(Math.random() * 91)
    }
    // Kill Feed (see _pushKillFeed) - one entry per kill at most, picked by
    // priority (boss > big combo > elite > melee) so a kill that qualifies
    // for several categories at once doesn't spam multiple stacked entries.
    if (BOSS_TIER_IDS.has(zombieTypeId)) {
      this._pushKillFeed('BOSS DOWN', 'boss')
      this._flagHighlightMoment('Boss down')
    } else if (this.comboCount >= COMBO_TIER3_THRESHOLD) {
      this._pushKillFeed(`${this.comboCount}x COMBO`, 'combo')
      this._flagHighlightMoment(`${this.comboCount}x combo`)
    } else if (isElite) {
      this._pushKillFeed('Elite eliminated', 'elite')
    } else if (weaponId === 'melee') {
      this._pushKillFeed('Melee finish')
    }
    // Industrial Siren bonus (Interactive World batch, see
    // _pullSirenLever) - applied here so the popup itself already reflects
    // the boosted total, same "multiply before display" approach
    // doublePointsMult above already uses for points.
    if (this.sirenLootBonusUntil && performance.now() < this.sirenLootBonusUntil) {
      coinsEarned = Math.round(coinsEarned * SIREN_BONUS_LOOT_MULT)
    }
    this.coins += coinsEarned
    this._showCoinPopup(coinsEarned)
    this._updateStatsPanel()

    if (!this.bestiaryEncountered.has(zombieTypeId)) {
      this.bestiaryEncountered.add(zombieTypeId)
      saveEncountered(this.bestiaryEncountered)
      if (this.bestiaryEncountered.size >= Object.keys(ZOMBIE_TYPES).length) {
        this.achievements.unlock('bestiary_master')
        if (!this.ownedSkins.has('obsidian')) {
          this.ownedSkins.add('obsidian')
          this._showLoreToast(t('obsidianSkinUnlocked'))
        }
      }
    }

    if (waveCleared) this._triggerWaveClearedCam()
  }
```

This step's replacement moves `isCarrier`'s loot drop (`pickups.spawnLootDrop(...)`) into the world-effects half but keeps its toast (`toastCarrierDropped`) in the personal half - the drop itself is world-state, the flavor text is about the credited player's own moment.

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "Split _onZombieKilled into world-effects and personal-rewards halves (Phase 5)"
```

---

### Task 5: Fix the killstreak airstrike to work when credited to a guest

**Files:**
- Modify: `src/game/Game.js` (`_checkKillstreakReward`)

**Interfaces:**
- Consumes: `_queueMultiplayerInteraction` (existing, from Phase 4).
- Produces: the `interactions` list can now carry `{kind: 'killstreakAirstrike', x, z}` - Task 6 adds the host-side handler for it.

- [ ] **Step 1: Branch the airstrike case on host vs. guest**

Find:

```js
    } else if (this.killStreak === KILLSTREAK_AIRSTRIKE_THRESHOLD) {
      const pos = this.player.controls.object.position
      this.zombies.damageInRadius(pos.x, pos.z, KILLSTREAK_AIRSTRIKE_RADIUS, KILLSTREAK_AIRSTRIKE_DAMAGE_MIN, KILLSTREAK_AIRSTRIKE_DAMAGE_MAX)
      this._showLoreToast(t('killstreakAirstrike'))
    } else if (this.killStreak === KILLSTREAK_AMMO_THRESHOLD) {
```

Replace with:

```js
    } else if (this.killStreak === KILLSTREAK_AIRSTRIKE_THRESHOLD) {
      const pos = this.player.controls.object.position
      // Phase 5 multiplayer - _checkKillstreakReward runs wherever the
      // credited player's own personal-rewards half runs (host or a
      // guest), but the airstrike itself has to land on the host's real
      // zombies (only those are ever visible to anyone else). A guest
      // reports where to strike instead of striking locally.
      if (!this._multiplayerSessionId || this._multiplayerIsHost) {
        this.zombies.damageInRadius(pos.x, pos.z, KILLSTREAK_AIRSTRIKE_RADIUS, KILLSTREAK_AIRSTRIKE_DAMAGE_MIN, KILLSTREAK_AIRSTRIKE_DAMAGE_MAX)
      } else {
        this._queueMultiplayerInteraction({ kind: 'killstreakAirstrike', x: pos.x, z: pos.z })
      }
      this._showLoreToast(t('killstreakAirstrike'))
    } else if (this.killStreak === KILLSTREAK_AMMO_THRESHOLD) {
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "Relay the killstreak airstrike to the host when credited to a guest (Phase 5)"
```

---

### Task 6: Wire the killEvents relay and the airstrike interaction handler

**Files:**
- Modify: `api/multiplayer/sync.js`
- Modify: `src/game/Multiplayer.js`
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `_queueKillEvent` is referenced by Task 4's dispatcher - this task defines it for real.
- Produces: `killEvents` field end-to-end (host sends, server stores per-recipient and delivers-and-clears, guest receives and applies).

- [ ] **Step 1: Accept and store `killEvents` per recipient (mirrors `remoteDamage` exactly)**

Find in `api/multiplayer/sync.js`:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions } = req.body || {}
```

Replace with:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents } = req.body || {}
```

Find:

```js
  if (Array.isArray(remoteDamage) && remoteDamage.length) {
    // Keyed per target player (unlike pendingHits' single shared inbox) so
    // a damage report addressed to one player can never be delivered to a
    // different one - see the per-caller drain below.
    const updates = {}
    for (const entry of remoteDamage) {
      const key = sessionRef.child(`world/remoteDamage/${entry.playerId}`).push().key
      updates[`world/remoteDamage/${entry.playerId}/${key}`] = {
        damage: entry.damage, kind: entry.kind, originX: entry.originX ?? null, originZ: entry.originZ ?? null,
      }
    }
    await sessionRef.update(updates)
  }
```

Replace with:

```js
  if (Array.isArray(remoteDamage) && remoteDamage.length) {
    // Keyed per target player (unlike pendingHits' single shared inbox) so
    // a damage report addressed to one player can never be delivered to a
    // different one - see the per-caller drain below.
    const updates = {}
    for (const entry of remoteDamage) {
      const key = sessionRef.child(`world/remoteDamage/${entry.playerId}`).push().key
      updates[`world/remoteDamage/${entry.playerId}/${key}`] = {
        damage: entry.damage, kind: entry.kind, originX: entry.originX ?? null, originZ: entry.originZ ?? null,
      }
    }
    await sessionRef.update(updates)
  }

  if (isHost && Array.isArray(killEvents) && killEvents.length) {
    // Phase 5 multiplayer - a kill event or a Last Stand revival, both
    // addressed to a specific credited/downed player. Same per-recipient
    // shape as remoteDamage above, for the exact same reason (only that
    // one player should ever receive it).
    const updates = {}
    for (const entry of killEvents) {
      const key = sessionRef.child(`world/killEvents/${entry.playerId}`).push().key
      updates[`world/killEvents/${entry.playerId}/${key}`] = entry.payload
    }
    await sessionRef.update(updates)
  }
```

- [ ] **Step 2: Deliver-and-clear this caller's own killEvents inbox**

Find:

```js
  // Any player (host or guest) can be on the receiving end of a remote
  // damage report - a guest gets hit by a zombie that picked it as the
  // nearest target, delivered here under its own playerId. Same
  // deliver-and-clear reasoning as pendingHits above.
  const myRemoteDamageSnapshot = await sessionRef.child(`world/remoteDamage/${playerId}`).once('value')
  const myRemoteDamage = myRemoteDamageSnapshot.val() || {}
  const remoteDamageOut = Object.values(myRemoteDamage)
  if (remoteDamageOut.length) await sessionRef.child(`world/remoteDamage/${playerId}`).remove()
```

Replace with:

```js
  // Any player (host or guest) can be on the receiving end of a remote
  // damage report - a guest gets hit by a zombie that picked it as the
  // nearest target, delivered here under its own playerId. Same
  // deliver-and-clear reasoning as pendingHits above.
  const myRemoteDamageSnapshot = await sessionRef.child(`world/remoteDamage/${playerId}`).once('value')
  const myRemoteDamage = myRemoteDamageSnapshot.val() || {}
  const remoteDamageOut = Object.values(myRemoteDamage)
  if (remoteDamageOut.length) await sessionRef.child(`world/remoteDamage/${playerId}`).remove()

  const myKillEventsSnapshot = await sessionRef.child(`world/killEvents/${playerId}`).once('value')
  const myKillEvents = myKillEventsSnapshot.val() || {}
  const killEventsOut = Object.values(myKillEvents)
  if (killEventsOut.length) await sessionRef.child(`world/killEvents/${playerId}`).remove()
```

- [ ] **Step 3: Include it in the response**

Find:

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions,
  })
}
```

Replace with:

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions, killEvents: killEventsOut,
  })
}
```

- [ ] **Step 4: Update `Multiplayer.js`'s return shape**

Find:

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

Replace with:

```js
export async function syncPlayerState(sessionId, state) {
  const playerId = _playerIdFor.get(sessionId)
  if (!playerId) throw new Error('Not in this session')
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
    killEvents: killEvents || [],
  }
}
```

- [ ] **Step 5: Add the sending queue and `_queueKillEvent` helper in `Game.js`**

Find in the constructor:

```js
    this._collectedPickupIds = new Set()
```

Replace with:

```js
    this._collectedPickupIds = new Set()
    // Phase 5 multiplayer - {playerId, payload}[] the host drains into its
    // next sync payload. payload is either a kill event (kind: 'kill') or
    // a Last Stand revival (kind: 'revive') - see _queueKillEvent/Task 10.
    this._pendingKillEvents = []
```

Add this method near `_queueMultiplayerInteraction`:

```js
  // Host-only (a guest never queues one of these - it only ever receives
  // them). Safe to call unconditionally elsewhere in the file for the same
  // reason _queueMultiplayerInteraction is.
  _queueKillEvent(playerId, payload) {
    if (!this._multiplayerIsHost) return
    this._pendingKillEvents.push({ playerId, payload })
  }
```

- [ ] **Step 6: Send the queue and apply what comes back**

Find:

```js
      payload.pickups = this.pickups.pickups.map((p) => ({ id: p.id, type: p.type, x: p.group.position.x, z: p.group.position.z }))
      payload.chests = this.chests.chests.map((c) => ({ locked: c.locked, opened: c.opened }))
      payload.vaultOpened = this.vault.opened
      payload.windows = this.barricadeWindows.windows.map((w) => ({ planks: w.planks }))
    } else if (this._pendingZombieHits.length) {
```

Replace with:

```js
      payload.pickups = this.pickups.pickups.map((p) => ({ id: p.id, type: p.type, x: p.group.position.x, z: p.group.position.z }))
      payload.chests = this.chests.chests.map((c) => ({ locked: c.locked, opened: c.opened }))
      payload.vaultOpened = this.vault.opened
      payload.windows = this.barricadeWindows.windows.map((w) => ({ planks: w.planks }))
      if (this._pendingKillEvents.length) {
        payload.killEvents = this._pendingKillEvents
        this._pendingKillEvents = []
      }
    } else if (this._pendingZombieHits.length) {
```

Find:

```js
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions }) => {
```

Replace with:

```js
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents }) => {
```

Find the `interactions`-handling `for` loop's closing brace (still inside `if (this._multiplayerIsHost) { ... }`):

```js
            } else if (interaction.kind === 'repairWindow') {
              this.barricadeWindows.repair(this.barricadeWindows.windows[interaction.windowIndex])
            }
          }
        } else {
```

Replace with:

```js
            } else if (interaction.kind === 'repairWindow') {
              this.barricadeWindows.repair(this.barricadeWindows.windows[interaction.windowIndex])
            } else if (interaction.kind === 'killstreakAirstrike') {
              this.zombies.damageInRadius(interaction.x, interaction.z, KILLSTREAK_AIRSTRIKE_RADIUS, KILLSTREAK_AIRSTRIKE_DAMAGE_MIN, KILLSTREAK_AIRSTRIKE_DAMAGE_MAX)
            }
          }
        } else {
```

Find the `else` branch's closing (the guest-side handling block) - locate the line right after the `windows` loop closes:

```js
          for (let i = 0; i < windows.length; i++) {
            const window = this.barricadeWindows.windows[i]
            const state = windows[i]
            if (window && state) window.planks = state.planks
          }
        }
```

Replace with:

```js
          for (let i = 0; i < windows.length; i++) {
            const window = this.barricadeWindows.windows[i]
            const state = windows[i]
            if (window && state) window.planks = state.planks
          }
          // Phase 5 multiplayer - a kill this guest actually earned
          // credit for, or a Last Stand revival relayed to it (see Task
          // 10). Delivered per-recipient (server already filters this
          // down to entries addressed to this player), never broadcast.
          for (const event of killEvents) {
            if (event.kind === 'kill') {
              this._onZombieKilledPersonalRewards(event.zombieTypeId, event.weaponId, event.x, event.z, event.isElite, event.isWandering, event.isGolden, event.wasFleeing, event.isCarrier, event.waveCleared)
            } else if (event.kind === 'revive') {
              this._reviveFromLastStand()
            }
          }
        }
```

- [ ] **Step 7: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add api/multiplayer/sync.js src/game/Multiplayer.js src/game/Game.js
git commit -m "Wire the killEvents relay and the killstreak airstrike interaction (Phase 5)"
```

---

### Task 7: Give XP gems a real id and a guest-side shared array

**Files:**
- Modify: `src/game/XpGems.js`

**Interfaces:**
- Produces: `XpGem` (exported), `XpGemManager.sharedGems` (array), `XpGemManager.updateSharedGems(dt, elapsed, playerPos, onCollect)` - Task 8 uses both. `onCollect(id, value)` fires once per collected gem, with the gem already removed from `sharedGems` (mirroring Phase 4's `Pickup`/`updateSharedPickups`, including its own dedup fix built in from the start this time - see Task 8).

- [ ] **Step 1: Add a real id**

Find:

```js
const PICKUP_RADIUS = 1.6
const EXPIRE_MS = 20000
```

Replace with:

```js
const PICKUP_RADIUS = 1.6
const EXPIRE_MS = 20000

// Phase 5 multiplayer (docs/superpowers/specs/2026-08-25-multiplayer-phase5-reward-integrity-design.md) -
// same globally-incrementing-id pattern as Zombie.js's zombieIdCounter and
// Pickups.js's pickupIdCounter.
let gemIdCounter = 0
```

Find:

```js
class XpGem {
  constructor(x, z, value) {
    this.value = value
    this.spawnedAt = performance.now()
```

Replace with:

```js
export class XpGem {
  constructor(x, z, value) {
    this.id = gemIdCounter++
    this.value = value
    this.spawnedAt = performance.now()
```

- [ ] **Step 2: Add the guest-side shared array and proximity-collect method**

Find:

```js
export class XpGemManager {
  constructor(scene) {
    this.scene = scene
    this.gems = []
  }
```

Replace with:

```js
export class XpGemManager {
  constructor(scene) {
    this.scene = scene
    this.gems = []
    // Phase 5 multiplayer - a guest's network-driven XpGem instances (see
    // Game.js's _renderSharedGems), kept separate from this.gems (the
    // real, host-simulated array) - same pattern as PickupManager.sharedPickups.
    this.sharedGems = []
  }
```

Find:

```js
  reset() {
    for (const gem of this.gems) this.scene.remove(gem.mesh)
    this.gems = []
  }
}
```

Replace with:

```js
  // Guest-side only counterpart to update() above, checked against
  // sharedGems (network-driven) instead of this.gems (the real array,
  // which only the host ever populates in a shared session). Reuses the
  // same radius math as update() but calls onCollect(id, value) once per
  // collected gem, with that gem already spliced out of sharedGems - same
  // shape as PickupManager.updateSharedPickups.
  updateSharedGems(dt, elapsed, playerPos, onCollect) {
    for (const gem of this.sharedGems) gem.update(dt, elapsed)
    const toRemove = []
    for (const gem of this.sharedGems) {
      const dist = Math.hypot(playerPos.x - gem.mesh.position.x, playerPos.z - gem.mesh.position.z)
      if (dist <= PICKUP_RADIUS) toRemove.push(gem)
    }
    for (const gem of toRemove) {
      this.scene.remove(gem.mesh)
      const idx = this.sharedGems.indexOf(gem)
      if (idx !== -1) this.sharedGems.splice(idx, 1)
      onCollect(gem.id, gem.value)
    }
  }

  reset() {
    for (const gem of this.gems) this.scene.remove(gem.mesh)
    this.gems = []
  }
}
```

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/game/XpGems.js
git commit -m "Give XP gems a real id and a guest-side shared array (Phase 5)"
```

---

### Task 8: Render and collect shared XP gems on the guest side

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `XpGem`/`XpGemManager.sharedGems`/`updateSharedGems` (Task 7).
- Produces: `_renderSharedGems(gemsSnapshot)` - Task 9 calls this from the guest branch.

- [ ] **Step 1: Import `XpGem`**

Find:

```js
import { XpGemManager } from './XpGems.js'
```

Replace with:

```js
import { XpGemManager, XpGem } from './XpGems.js'
```

- [ ] **Step 2: Add the already-collected dedup set, built in from the start (this is the fix Phase 4 had to discover the hard way for ground loot - see that phase's own "Fix repeated re-collection" commit)**

Find in the constructor:

```js
    this._collectedPickupIds = new Set()
```

Replace with:

```js
    this._collectedPickupIds = new Set()
    // Phase 5 - same "already collected, ignore until it's gone from the
    // snapshot" guard Phase 4 needed for ground loot pickups (see that
    // phase's fix commit), built in here from the start instead of
    // rediscovering the same bug.
    this._collectedGemIds = new Set()
```

- [ ] **Step 3: Add `_renderSharedGems`, mirroring `_renderSharedPickups` exactly (including its own dedup guard)**

Add this method right after `_renderSharedPickups`:

```js
  // Guest-side only - mirrors _renderSharedPickups' exact pattern
  // (including the "already collected, ignore until gone from the
  // snapshot" guard - see Task 7/8's own comments for why this is needed)
  // for XP gems instead of loot drops.
  _renderSharedGems(gemsSnapshot) {
    const seenIds = new Set()
    for (const [idStr, state] of Object.entries(gemsSnapshot)) {
      if (!state) continue
      const id = Number(idStr.slice(1))
      seenIds.add(id)
      if (this._collectedGemIds.has(id)) continue
      const alreadyRendered = this.xpGems.sharedGems.some((g) => g.id === id)
      if (!alreadyRendered) {
        const gem = new XpGem(state.x, state.z, state.value)
        gem.id = id
        this.xpGems.sharedGems.push(gem)
        this.scene.add(gem.mesh)
      }
    }
    for (const id of this._collectedGemIds) {
      if (!seenIds.has(id)) this._collectedGemIds.delete(id)
    }
    for (const gem of [...this.xpGems.sharedGems]) {
      if (seenIds.has(gem.id)) continue
      this.scene.remove(gem.mesh)
      const idx = this.xpGems.sharedGems.indexOf(gem)
      if (idx !== -1) this.xpGems.sharedGems.splice(idx, 1)
    }
  }
```

- [ ] **Step 4: Gate the guest's own `xpGems.update` call and collect from the shared snapshot instead**

Find:

```js
      this.xpGems.update(dt, elapsed, playerPos, (value) => this._onXpGemCollected(value))
```

Replace with:

```js
      // Same host-only gating as pickups.update above - a guest's own
      // XpGemManager.gems is never populated in a shared session (see
      // _onZombieKilledWorldEffects, host-only), so this would just be a
      // permanent no-op loop over nothing.
      if (!this._multiplayerSessionId || this._multiplayerIsHost) {
        this.xpGems.update(dt, elapsed, playerPos, (value) => this._onXpGemCollected(value))
      } else {
        this.xpGems.updateSharedGems(dt, elapsed, playerPos, (id, value) => {
          this._collectedGemIds.add(id)
          this._onXpGemCollected(value)
          this._queueMultiplayerInteraction({ kind: 'collectGem', gemId: id })
        })
      }
```

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "Render and collect shared XP gems on the guest side (Phase 5)"
```

---

### Task 9: Broadcast XP gems from the host and process guest collections

**Files:**
- Modify: `api/multiplayer/sync.js`
- Modify: `src/game/Multiplayer.js`
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `_renderSharedGems` (Task 8), the existing `interactions` channel.
- Produces: `xpGems` broadcast field end-to-end; host handles `collectGem` interactions.

- [ ] **Step 1: Store and broadcast the host's gems (same shape as `pickups`)**

Find in `api/multiplayer/sync.js`:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents } = req.body || {}
```

Replace with:

```js
  const { sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring, zombies, hits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems } = req.body || {}
```

Find:

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

- [ ] **Step 2: Read it back and include it in the response**

Find:

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

Replace with:

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

Find:

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions, killEvents: killEventsOut,
  })
}
```

Replace with:

```js
  res.status(200).json({
    states, zombies: zombiesSnapshot.val() || {}, pendingHits, worldEvents: worldEventsOut, remoteDamage: remoteDamageOut,
    pickups: pickupsSnapshot.val() || {}, chests: chestsSnapshot.val() || [], vaultOpened: vaultOpenedSnapshot.val() || false,
    windows: windowsSnapshot.val() || [], interactions: pendingInteractions, killEvents: killEventsOut,
    xpGems: xpGemsSnapshot.val() || {},
  })
}
```

- [ ] **Step 3: Update `Multiplayer.js`'s return shape**

Find:

```js
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
    killEvents: killEvents || [],
  }
```

Replace with:

```js
  const { states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems } = await _apiCall('sync', { sessionId, playerId, ...state })
  return {
    states, zombies: zombies || {}, pendingHits: pendingHits || [], worldEvents: worldEvents || [], remoteDamage: remoteDamage || [],
    pickups: pickups || {}, chests: chests || [], vaultOpened: !!vaultOpened, windows: windows || [], interactions: interactions || [],
    killEvents: killEvents || [], xpGems: xpGems || {},
  }
```

- [ ] **Step 4: Host sends its gems and processes `collectGem` reports; guest renders from the broadcast**

Find in `Game.js`:

```js
      if (this._pendingKillEvents.length) {
        payload.killEvents = this._pendingKillEvents
        this._pendingKillEvents = []
      }
    } else if (this._pendingZombieHits.length) {
```

Replace with:

```js
      if (this._pendingKillEvents.length) {
        payload.killEvents = this._pendingKillEvents
        this._pendingKillEvents = []
      }
      payload.xpGems = this.xpGems.gems.map((g) => ({ id: g.id, value: g.value, x: g.mesh.position.x, z: g.mesh.position.z }))
    } else if (this._pendingZombieHits.length) {
```

Find:

```js
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents }) => {
```

Replace with:

```js
      Multiplayer.syncPlayerState(this._multiplayerSessionId, payload).then(({ states, zombies, pendingHits, worldEvents, remoteDamage, pickups, chests, vaultOpened, windows, interactions, killEvents, xpGems }) => {
```

Find:

```js
            } else if (interaction.kind === 'killstreakAirstrike') {
              this.zombies.damageInRadius(interaction.x, interaction.z, KILLSTREAK_AIRSTRIKE_RADIUS, KILLSTREAK_AIRSTRIKE_DAMAGE_MIN, KILLSTREAK_AIRSTRIKE_DAMAGE_MAX)
            }
          }
        } else {
```

Replace with:

```js
            } else if (interaction.kind === 'killstreakAirstrike') {
              this.zombies.damageInRadius(interaction.x, interaction.z, KILLSTREAK_AIRSTRIKE_RADIUS, KILLSTREAK_AIRSTRIKE_DAMAGE_MIN, KILLSTREAK_AIRSTRIKE_DAMAGE_MAX)
            } else if (interaction.kind === 'collectGem') {
              const gem = this.xpGems.gems.find((g) => g.id === interaction.gemId)
              if (gem) {
                this.scene.remove(gem.mesh)
                const idx = this.xpGems.gems.indexOf(gem)
                if (idx !== -1) this.xpGems.gems.splice(idx, 1)
              }
            }
          }
        } else {
```

Find:

```js
          this._renderSharedZombies(zombies, feetX, feetZ)
          this._renderSharedPickups(pickups)
```

Replace with:

```js
          this._renderSharedZombies(zombies, feetX, feetZ)
          this._renderSharedPickups(pickups)
          this._renderSharedGems(xpGems)
```

- [ ] **Step 5: Build check**

Run: `npx vite build`
Expected: succeeds, no leftover references anywhere in `Game.js` to a `.then(({ ... })` destructuring that's missing `xpGems`.

- [ ] **Step 6: Commit**

```bash
git add api/multiplayer/sync.js src/game/Multiplayer.js src/game/Game.js
git commit -m "Broadcast XP gems and process guest gem collection (Phase 5)"
```

---

### Task 10: Report becoming downed and track it on the host

**Files:**
- Modify: `src/game/Game.js` (`_tryLastStand`, constructor)

**Interfaces:**
- Produces: `this._guestDownedState` (Map, `playerId -> killsNeeded`) - Task 11 reads and mutates it.

- [ ] **Step 1: Add the tracking map**

Find in the constructor:

```js
    this._pendingKillEvents = []
```

Replace with:

```js
    this._pendingKillEvents = []
    // Phase 5 multiplayer - host-only. A guest becoming downed reports it
    // (see _tryLastStand below); every kill (regardless of who's
    // credited) decrements every entry here, same as the host's own
    // playerDowned/downedKillsNeeded - see _onZombieKilledWorldEffects.
    this._guestDownedState = new Map()
```

- [ ] **Step 2: Report it when a guest goes down**

Find:

```js
  _tryLastStand() {
    if (this.lastStandUsed) return false
    this.lastStandUsed = true
    this.playerState.alive = true
    this.playerState.health = 1
    this.playerDowned = true
    this.downedKillsNeeded = LAST_STAND_KILLS_NEEDED
    this.downedUntil = performance.now() + LAST_STAND_DURATION_MS
    this._preDownedMoveSpeed = this.player.moveSpeed
    this.player.moveSpeed *= LAST_STAND_SPEED_MULT
    const pistolIdx = this.weapons.weapons.findIndex((w) => w.id === 'pistol')
    if (pistolIdx >= 0) this.weapons.currentIndex = pistolIdx
    this._updateHealthHud()
    this._updateHotbarHud()
    this._showLoreToast(t('lastStandEntered', { n: LAST_STAND_KILLS_NEEDED }))
    return true
  }
```

Replace with:

```js
  _tryLastStand() {
    if (this.lastStandUsed) return false
    this.lastStandUsed = true
    this.playerState.alive = true
    this.playerState.health = 1
    this.playerDowned = true
    this.downedKillsNeeded = LAST_STAND_KILLS_NEEDED
    this.downedUntil = performance.now() + LAST_STAND_DURATION_MS
    this._preDownedMoveSpeed = this.player.moveSpeed
    this.player.moveSpeed *= LAST_STAND_SPEED_MULT
    const pistolIdx = this.weapons.weapons.findIndex((w) => w.id === 'pistol')
    if (pistolIdx >= 0) this.weapons.currentIndex = pistolIdx
    this._updateHealthHud()
    this._updateHotbarHud()
    this._showLoreToast(t('lastStandEntered', { n: LAST_STAND_KILLS_NEEDED }))
    // Phase 5 multiplayer - the host already has authoritative access to
    // its own playerDowned/downedKillsNeeded (checked directly in
    // _onZombieKilledWorldEffects), no report needed. A guest needs to
    // tell the host it's now down and how many kills it needs, so ANY
    // kill (by either player) can start counting down - per Gaymi's
    // explicit choice that either player's kills should be able to save
    // a downed teammate.
    if (this._multiplayerSessionId && !this._multiplayerIsHost) {
      this._queueMultiplayerInteraction({ kind: 'becameDowned', killsNeeded: LAST_STAND_KILLS_NEEDED })
    }
    return true
  }
```

- [ ] **Step 3: Handle the report on the host**

Find:

```js
            } else if (interaction.kind === 'collectGem') {
              const gem = this.xpGems.gems.find((g) => g.id === interaction.gemId)
              if (gem) {
                this.scene.remove(gem.mesh)
                const idx = this.xpGems.gems.indexOf(gem)
                if (idx !== -1) this.xpGems.gems.splice(idx, 1)
              }
            }
          }
        } else {
```

Replace with:

```js
            } else if (interaction.kind === 'collectGem') {
              const gem = this.xpGems.gems.find((g) => g.id === interaction.gemId)
              if (gem) {
                this.scene.remove(gem.mesh)
                const idx = this.xpGems.gems.indexOf(gem)
                if (idx !== -1) this.xpGems.gems.splice(idx, 1)
              }
            } else if (interaction.kind === 'becameDowned' && interaction.fromPlayerId) {
              this._guestDownedState.set(interaction.fromPlayerId, interaction.killsNeeded)
            }
          }
        } else {
```

- [ ] **Step 4: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "Report a guest becoming downed and track it on the host (Phase 5)"
```

---

### Task 11: Decrement every downed player on each kill and relay revival

**Files:**
- Modify: `src/game/Game.js` (`_onZombieKilledWorldEffects`)

**Interfaces:**
- Consumes: `_guestDownedState` (Task 10), `_queueKillEvent` (Task 6).

- [ ] **Step 1: Extend the Last Stand block in `_onZombieKilledWorldEffects`**

Find:

```js
    // Last Stand - clawing back up under your own power, not a passive
    // timer-only wait (see _tryLastStand/downedKillsNeeded). The host's own
    // downed state (unchanged from before this phase) plus every tracked
    // guest's downed state (Task 10) both decrement on every kill,
    // regardless of who's credited - a teammate's kill should be able to
    // save you, per Gaymi's explicit choice.
    if (this.playerDowned) {
      this.downedKillsNeeded -= 1
      if (this.downedKillsNeeded <= 0) this._reviveFromLastStand()
    }
```

Replace with:

```js
    // Last Stand - clawing back up under your own power, not a passive
    // timer-only wait (see _tryLastStand/downedKillsNeeded). The host's own
    // downed state (unchanged from before this phase) plus every tracked
    // guest's downed state (Task 10) both decrement on every kill,
    // regardless of who's credited - a teammate's kill should be able to
    // save you, per Gaymi's explicit choice.
    if (this.playerDowned) {
      this.downedKillsNeeded -= 1
      if (this.downedKillsNeeded <= 0) this._reviveFromLastStand()
    }
    for (const [guestId, killsNeeded] of [...this._guestDownedState]) {
      const remaining = killsNeeded - 1
      if (remaining <= 0) {
        this._guestDownedState.delete(guestId)
        this._queueKillEvent(guestId, { kind: 'revive' })
      } else {
        this._guestDownedState.set(guestId, remaining)
      }
    }
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "Decrement every downed player on each shared kill and relay revival (Phase 5)"
```

---

### Task 12: Deploy and verify with two real browser sessions

**Files:**
- None (deploy + verification only).

**Interfaces:**
- Consumes: everything from Tasks 1-11.

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
    deadline = time.time() + 60
    while time.time() < deadline and not host_page.evaluate("() => !!window.__game"):
        time.sleep(0.3)
    host_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")

    session_id = host_page.evaluate("""async () => {
        window.__game.settings.nickname = 'ZombieHost'
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    print("session:", session_id)

    guest_page.goto(f'https://gayz.vercel.app/?join={session_id}', timeout=60000)
    deadline = time.time() + 60
    while time.time() < deadline and not guest_page.evaluate("() => !!window.__game"):
        time.sleep(0.3)
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

    # Wait out the 30s anti-abuse guard before the "guest gets credited"
    # check, so that check specifically exercises the normal path, not the
    # guard (the guard gets its own separate, explicit check further down).
    print("waiting 32s past the anti-abuse guard window...")
    time.sleep(32)

    # --- A guest-credited kill changes the GUEST's own coins/kills, not the host's ---
    host_page.evaluate("() => window.__game.zombies._spawnRandom()")
    zid = None
    for _ in range(40):
        zid = host_page.evaluate("""() => {
            const z = window.__game.zombies.zombies.find((zz) => zz.state === 'alive')
            return z ? z.id : null
        }""")
        if zid is not None:
            break
        host_page.evaluate("() => window.__game.zombies._spawnRandom()")
    print("zombie id to kill:", zid)

    guest_id = host_page.evaluate("() => window.__game._otherPlayerPositions[0]?.playerId")
    print("guest's own player id (as seen by host):", guest_id)

    guest_coins_before = guest_page.evaluate("() => window.__game.coins")
    guest_kills_before = guest_page.evaluate("() => window.__game.kills")
    host_coins_before = host_page.evaluate("() => window.__game.coins")

    # Simulate the guest's own hit report reaching the host (same shape a
    # real WeaponSystem hit would produce) - directly exercising the real
    # onHit -> death-detection -> credit chain rather than the network hit
    # relay itself (already covered by Phase 3's own verification).
    host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {zid})
        z.onHit(9999, {{ fromPlayerId: '{guest_id}' }})
    }}""")

    guest_coins_changed = poll_both(lambda: guest_page.evaluate("() => window.__game.coins") != guest_coins_before, host_page, guest_page, timeout=180)
    guest_coins_after = guest_page.evaluate("() => window.__game.coins")
    guest_kills_after = guest_page.evaluate("() => window.__game.kills")
    host_coins_after = host_page.evaluate("() => window.__game.coins")
    print("guest coins before/after:", guest_coins_before, guest_coins_after)
    print("guest kills before/after:", guest_kills_before, guest_kills_after)
    print("host coins before/after (should be unchanged):", host_coins_before, host_coins_after)
    print("PASS - guest credited, host untouched:", guest_coins_after > guest_coins_before and guest_kills_after > guest_kills_before and host_coins_after == host_coins_before)

    # --- A loot drop from that kill still appears in the host's real PickupManager (world-effect, unaffected by credit) ---
    host_pickups_len = host_page.evaluate("() => window.__game.pickups.pickups.length")
    print("host's real pickups array length after a guest-credited kill (world-effects still ran host-side):", host_pickups_len)

    # --- An XP gem from that kill appears on both screens and only the collector's XP changes ---
    guest_gem_seen = poll_both(lambda: guest_page.evaluate("() => window.__game.xpGems.sharedGems.length") > 0, host_page, guest_page, timeout=180)
    print("guest sees at least one shared XP gem:", guest_gem_seen)

    # --- Anti-abuse guard: a kill within 30s of joining falls back to the host ---
    session_id_2 = host_page.evaluate("""async () => {
        await window.__game._createMultiplayerSession()
        return window.__game._multiplayerSessionId
    }""")
    guest_page.goto(f'https://gayz.vercel.app/?join={session_id_2}', timeout=60000)
    deadline = time.time() + 60
    while time.time() < deadline and not guest_page.evaluate("() => !!window.__game"):
        time.sleep(0.3)
    guest_page.evaluate("() => { const l = document.getElementById('asset-loader'); if (l) l.style.display = 'none' }")
    guest_page.evaluate(f"""async () => {{
        await window.__game._joinMultiplayerSession('{session_id_2}')
    }}""")
    for pg in (host_page, guest_page):
        pg.evaluate("() => { window.__game.gameStarted = true; window.__game.player.controls.isLocked = true; window.__game.playerState.alive = true }")

    host_page.evaluate("() => window.__game.zombies._spawnRandom()")
    zid2 = None
    for _ in range(40):
        zid2 = host_page.evaluate("""() => {
            const z = window.__game.zombies.zombies.find((zz) => zz.state === 'alive')
            return z ? z.id : null
        }""")
        if zid2 is not None:
            break
        host_page.evaluate("() => window.__game.zombies._spawnRandom()")

    new_guest_id = host_page.evaluate("() => window.__game._otherPlayerPositions[0]?.playerId")
    host_coins_before_2 = host_page.evaluate("() => window.__game.coins")
    host_page.evaluate(f"""() => {{
        const z = window.__game.zombies.zombies.find((zz) => zz.id === {zid2})
        z.onHit(9999, {{ fromPlayerId: '{new_guest_id}' }})
    }}""")
    host_credited_instead = poll_both(lambda: host_page.evaluate("() => window.__game.coins") != host_coins_before_2, host_page, guest_page, timeout=180)
    print("PASS - a too-recently-joined guest's kill fell back to crediting the host:", host_credited_instead)

    browser.close()
```

Expected: `PASS - guest credited, host untouched` is `True`, `host's real pickups array length` is greater than 0 (world-effects ran even though the guest got personal credit), `guest sees at least one shared XP gem` is `True`, and `PASS - a too-recently-joined guest's kill fell back to crediting the host` is `True`.

- [ ] **Step 3: No commit needed** - this task deploys and verifies already-committed code from Tasks 1-11.

**Gaymi's test for this batch - needs your friend again, and needs to be played for real (not just spot-checked) given how much this touches:**
1. Start a run together, both join the same session, play normally for at least a minute (past the 30-second guard).
2. Have your friend get a kill or two. Check their own coins/kill count went up, not yours.
3. Check achievements - have your friend do something achievement-worthy (first kill of the session, a melee brute kill, etc.) and confirm THEIR achievement panel shows the unlock, not yours.
4. Confirm a loot drop or XP gem from your friend's kill still shows up and is collectible on both of your screens.
5. If either of you goes down (Last Stand), confirm the OTHER player's kills count down the revive requirement, and that reaching zero actually revives the downed player.
6. If you get a killstreak airstrike while your friend is hosting (or vice versa), confirm it actually damages the shared zombies, not just plays the toast with no effect.

**What's still normal, not a bug:** joining a session and getting a kill in the first ~30 seconds credits the host instead of you - that's the anti-abuse guard working as intended, not a mis-credited kill.

**Failure looks like:** your friend's kills change YOUR coins/achievements instead of theirs, a loot/XP drop only shows on one screen, a downed player never gets revived by a teammate's kills, or an airstrike does nothing when credited to a guest.
