# Clan System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a lightweight "Crew" clan system - create/join a named group, see a combined stats view, show a `[TAG]` badge next to members' names - reusing the existing Firebase/Firestore social layer rather than building new backend machinery.

**Architecture:** One new Firestore collection (`clans/{clanId}`) and one new subcollection (`clans/{clanId}/members/{uid}`, doc-id-equals-own-uid, mirroring the existing `friendRequests` pattern exactly), plus two new denormalized fields on the existing `leaderboard/{uid}` doc (`clanId`, `clanTag`). All new CloudSync functions follow the exact plain-async-function-per-operation shape every existing CloudSync export already uses. UI lives entirely in a new 6th `.hub-section` in the existing Hub panel.

**Tech Stack:** Firebase Auth + Firestore (already integrated via `src/game/CloudSync.js`), vanilla JS/DOM, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-clan-system-design.md`

## Global Constraints

- Every new Firestore read/write follows the existing `ensureApp()` lazy-load pattern and returns/accepts plain objects, exactly like every existing `CloudSync.js` export - no new abstraction layer, no class.
- `clans/{clanId}/members/{uid}` is keyed by the member's own uid, mirroring `friendRequests/{toUid}/incoming/{fromUid}` exactly - a member can only ever create/delete their OWN membership doc.
- No server-side uniqueness enforcement on clan names/tags, no chat, no roles beyond leader/member, no clan-vs-clan ranking - matches the spec's Approach A scope exactly.
- Membership cap of 15, enforced client-side via `getCountFromServer` before allowing a join (not in security rules - see spec's own reasoning on why a rare race here is an acceptable non-security edge case).
- `FIRESTORE_SECURITY_RULES` is exported as the FULL ruleset - publishing it to Firebase Console always replaces what's live there, never a diff. The final task calls this out explicitly for whoever actually runs it.
- Fresh-read discipline: re-read the actual current file content before every edit in every task below - this plan cites real line numbers/snippets found while writing it, but `Game.js`/`CloudSync.js`/`index.html` have all been edited heavily this session.
- Build check (`npx vite build`) after every task, commit after every task. Push + deploy only in the final task.

---

### Task 1: Firestore security rules

**Files:**
- Modify: `src/game/CloudSync.js` (the `FIRESTORE_SECURITY_RULES` template-literal export)

**Interfaces:**
- Produces: the deployed-later ruleset every later task's Firestore calls depend on being correct (not actually deployable by this plan - Firebase Console access is a manual step, called out in Task 13).

- [ ] **Step 1: Add the two new `match` blocks**

Find the `FIRESTORE_SECURITY_RULES` template literal (search for `export const FIRESTORE_SECURITY_RULES`). Inside the `match /databases/{database}/documents {` block, alongside the existing `match /leaderboard/{userId}` etc. blocks, add:

```
    match /clans/{clanId} {
      allow read: if true;
      allow create: if request.auth != null
        && request.resource.data.leaderId == request.auth.uid
        && request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 24
        && request.resource.data.tag is string && request.resource.data.tag.size() > 0 && request.resource.data.tag.size() <= 4
        && request.resource.data.leaderNickname is string && request.resource.data.leaderNickname.size() > 0 && request.resource.data.leaderNickname.size() <= 16
        && request.resource.data.createdAt is int;
      allow update: if request.auth != null && request.auth.uid == resource.data.leaderId
        && request.resource.data.leaderId == resource.data.leaderId
        && request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 24
        && request.resource.data.tag is string && request.resource.data.tag.size() > 0 && request.resource.data.tag.size() <= 4;
      allow delete: if request.auth != null && request.auth.uid == resource.data.leaderId;
    }

    match /clans/{clanId}/members/{uid} {
      allow read: if true;
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.nickname is string && request.resource.data.nickname.size() > 0 && request.resource.data.nickname.size() <= 16
        && request.resource.data.joinedAt is int;
      allow delete: if request.auth != null
        && (request.auth.uid == uid || request.auth.uid == get(/databases/$(database)/documents/clans/$(clanId)).data.leaderId);
      allow update: if false;
    }
```

- [ ] **Step 2: Extend the existing `leaderboard/{userId}` rule's validated-field list**

Find the `match /leaderboard/{userId} { ... allow write: ...` block. It ends with a chain of `&& (!('field' in request.resource.data) || (...))` checks for optional fields like `region`/`playerId`/`lastActiveAt`. Add two more to that same chain (the field this project denormalizes the clan tag onto, alongside the id, is a plan-level addition beyond the spec's original single-field description - added here so `_renderLeaderboardRows`, the actual leaderboard-row renderer found by re-reading `Game.js` fresh, can show a `[TAG]` badge without a second query per row):

```
        && (!('clanId' in request.resource.data) || (request.resource.data.clanId is string && request.resource.data.clanId.size() > 0))
        && (!('clanTag' in request.resource.data) || (request.resource.data.clanTag is string && request.resource.data.clanTag.size() <= 4));
```

(This replaces whatever the block's final line currently ends with - re-read it fresh to see the exact last condition before this one, since it must stay chained with `&&`, not become a second top-level rule.)

- [ ] **Step 3: Build check**

Run: `npx vite build`
Expected: no errors (this is a plain string change, so this mostly just confirms no syntax slip in the template literal).

- [ ] **Step 4: Commit**

```bash
git add src/game/CloudSync.js
git commit -m "Add clans/clans-members Firestore rules, extend leaderboard rule with clanId/clanTag"
```

---

### Task 2: `settings.clanId` local cache field

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Produces: `settings.clanId` (`string | null`), read/written by every later UI task.

- [ ] **Step 1: Add to `loadSettings()`**

Find `loadSettings()` (search for `function loadSettings()`). Add, near other simple optional-string fields:

```js
      clanId: typeof parsed.clanId === 'string' ? parsed.clanId : null,
```

- [ ] **Step 2: Add to the bare-defaults object**

Find the huge one-line defaults object (search for `return { language: 'en', playerId: _generatePlayerId()`). Insert `clanId: null,` anywhere in that object (e.g. right after `touchControlsOverride: 'auto',` added earlier this session).

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Verify with Playwright**

```js
() => window.__game.settings.clanId
```
Expected: `null` on a fresh profile.

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js
git commit -m "Add settings.clanId local cache field"
```

---

### Task 3: CloudSync.js - create/lookup/fetch-members functions

**Files:**
- Modify: `src/game/CloudSync.js`

**Interfaces:**
- Consumes: `ensureApp()` (existing).
- Produces: `createClan(leaderUid, leaderNickname, name, tag)`, `fetchClanByName(name)`, `fetchClanMembers(clanId)` - used by Tasks 5-9.

- [ ] **Step 1: Add `createClan`**

Add near the other write functions (e.g. after `sendFriendRequest`):

```js
// Clans (lightweight "Crew" - see docs/superpowers/specs/2026-08-26-clan-system-design.md).
// clanId is a Firestore auto-generated doc id, not a player-chosen slug -
// avoids needing any uniqueness check on the id itself. The leader's own
// membership doc is created in the SAME call (not left to a separate
// joinClan call) so a freshly created clan never has zero members even
// for a moment.
export async function createClan(leaderUid, leaderNickname, name, tag) {
  const { db, fsMod } = await ensureApp()
  const clanRef = fsMod.doc(fsMod.collection(db, 'clans'))
  await fsMod.setDoc(clanRef, { name, tag, leaderId: leaderUid, leaderNickname, createdAt: Date.now() })
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanRef.id, 'members', leaderUid), { nickname: leaderNickname, joinedAt: Date.now() })
  return clanRef.id
}
```

- [ ] **Step 2: Add `fetchClanByName`**

Mirrors `fetchLeaderboardEntryByName` exactly, just a different collection:

```js
export async function fetchClanByName(name) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'clans'), fsMod.where('name', '==', name), fsMod.limit(1))
  const snap = await fsMod.getDocs(q)
  return snap.empty ? null : { ...snap.docs[0].data(), clanId: snap.docs[0].id }
}
```

- [ ] **Step 3: Add `fetchClanMembers`**

```js
export async function fetchClanMembers(clanId) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDocs(fsMod.collection(db, 'clans', clanId, 'members'))
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
}
```

- [ ] **Step 4: Build check**

Run: `npx vite build`

- [ ] **Step 5: Commit**

```bash
git add src/game/CloudSync.js
git commit -m "Add createClan/fetchClanByName/fetchClanMembers to CloudSync"
```

---

### Task 4: CloudSync.js - join/leave/kick + membership cap + combined stats

**Files:**
- Modify: `src/game/CloudSync.js`

**Interfaces:**
- Consumes: `ensureApp()`.
- Produces: `fetchClanMemberCount(clanId)`, `joinClan(clanId, uid, nickname)`, `leaveClan(clanId, uid)`, `kickClanMember(clanId, uid)`, `fetchClanCombinedStats(clanId)`.

- [ ] **Step 1: Add `fetchClanMemberCount`**

Mirrors `fetchMyGlobalRank`'s exact `getCountFromServer` pattern:

```js
export async function fetchClanMemberCount(clanId) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getCountFromServer(fsMod.collection(db, 'clans', clanId, 'members'))
  return snap.data().count
}
```

- [ ] **Step 2: Add `joinClan` (with the cap check inline)**

```js
// Membership cap (15) is enforced HERE, client-side, not in security
// rules - a rare race letting a 16th member slip through under
// simultaneous joins is an accepted non-security edge case (see spec).
const CLAN_MEMBER_CAP = 15

export async function joinClan(clanId, uid, nickname) {
  const count = await fetchClanMemberCount(clanId)
  if (count >= CLAN_MEMBER_CAP) return { ok: false, reason: 'full' }
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'clans', clanId, 'members', uid), { nickname, joinedAt: Date.now() })
  return { ok: true }
}
```

- [ ] **Step 3: Add `leaveClan` and `kickClanMember`**

Both are just a delete of a members-subcollection doc - the security rule (Task 1) is what actually distinguishes "leaving your own" from "kicking someone else's" (only the leader's uid can delete someone else's), so the client code for both is nearly identical, kept as two named functions for call-site clarity:

```js
export async function leaveClan(clanId, uid) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'clans', clanId, 'members', uid))
}

export async function kickClanMember(clanId, uid) {
  const { db, fsMod } = await ensureApp()
  await fsMod.deleteDoc(fsMod.doc(db, 'clans', clanId, 'members', uid))
}
```

- [ ] **Step 4: Add `fetchClanCombinedStats`**

Queries the EXISTING `leaderboard` collection filtered by the new `clanId` field, summing client-side - no new write-path, per the spec:

```js
export async function fetchClanCombinedStats(clanId) {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'leaderboard'), fsMod.where('clanId', '==', clanId))
  const snap = await fsMod.getDocs(q)
  let totalKills = 0
  let totalBestNight = 0
  for (const d of snap.docs) {
    const data = d.data()
    totalKills += Number(data.bestKills) || 0
    totalBestNight += Number(data.bestNight) || 0
  }
  return { memberCount: snap.size, totalKills, totalBestNight }
}
```

- [ ] **Step 5: Build check**

Run: `npx vite build`

- [ ] **Step 6: Commit**

```bash
git add src/game/CloudSync.js
git commit -m "Add joinClan/leaveClan/kickClanMember/fetchClanCombinedStats to CloudSync"
```

---

### Task 5: `leaderboard` writes carry `clanId`/`clanTag`

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `CloudSync.pushLeaderboardEntry` (existing), `settings.clanId` (Task 2).
- Produces: every future leaderboard write includes the player's current clan info, so `_renderLeaderboardRows` (Task 10) has something to read.

- [ ] **Step 1: Find every `pushLeaderboardEntry` call site**

Run: `grep -n "pushLeaderboardEntry(" src/game/Game.js` (re-run fresh - there are multiple call sites building the `entry` object passed as the second argument, each already including fields like `bestNight`, `bestKills`, `region`, `playerId`, etc. following the exact same object-literal shape).

- [ ] **Step 2: Add `clanId`/`clanTag` to each entry object**

For each call site found, add two lines to the object literal being built (following the exact same conditional-inclusion style the existing `region`/`playerId` fields already use - only include the key when there's a real value, since the security rule's `!('clanId' in request.resource.data) || ...` check treats an absent key differently from an empty string):

```js
      ...(this.settings.clanId ? { clanId: this.settings.clanId, clanTag: this._myClanTag || undefined } : {}),
```

(`this._myClanTag` is set in Task 8 when a player's clan membership is loaded/refreshed - until Task 8 lands, this spreads `clanTag: undefined`, which Firestore's `setDoc`/`updateDoc` simply omits from the write, matching the rule's "field is optional" treatment correctly.)

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "Carry clanId/clanTag on every leaderboard write"
```

---

### Task 6: Hub section HTML skeleton

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: the static DOM Tasks 7-9 attach behavior to.

- [ ] **Step 1: Add the new `.hub-section` after "Player"**

Find the "Player" `.hub-section` in `#hub-page-survival` (re-read fresh - was around index.html:1478-1486 when this plan was written, ending right before the "Difficulty" section starts). Insert immediately after its closing `</section>`:

```html
          <section class="hub-section">
            <h3 class="hub-section-title">Clan</h3>
            <div class="hub-section-list">
              <div id="clan-signin-gate" style="display: none">
                <p id="clan-signin-gate-text"></p>
              </div>
              <div id="clan-no-clan-state" style="display: none">
                <label class="menu-field-label" for="clan-create-name-input">Clan Name</label>
                <input type="text" id="clan-create-name-input" class="nickname-input" placeholder="Your clan's name" maxlength="24" />
                <label class="menu-field-label" for="clan-create-tag-input">Tag (2-4 letters)</label>
                <input type="text" id="clan-create-tag-input" class="nickname-input" placeholder="TAG" maxlength="4" />
                <button id="clan-create-btn" type="button" class="mini-action-btn">Create Clan</button>
                <p id="clan-create-taken-warning" style="display: none"></p>
                <label class="menu-field-label" for="clan-join-name-input">Join an Existing Clan</label>
                <input type="text" id="clan-join-name-input" class="nickname-input" placeholder="Clan name to search" maxlength="24" />
                <button id="clan-join-btn" type="button" class="mini-action-btn">Join</button>
                <p id="clan-join-status" style="display: none"></p>
              </div>
              <div id="clan-in-clan-state" style="display: none">
                <h4 id="clan-display-name"></h4>
                <p id="clan-display-tag"></p>
                <div id="clan-stats-card">
                  <p id="clan-stats-members"></p>
                  <p id="clan-stats-kills"></p>
                  <p id="clan-stats-night"></p>
                </div>
                <div id="clan-member-list"></div>
                <button id="clan-leave-btn" type="button" class="mini-action-btn">Leave Clan</button>
                <p id="clan-leave-disabled-hint" style="display: none"></p>
              </div>
            </div>
          </section>
```

- [ ] **Step 2: Build check**

Run: `npx vite build`

- [ ] **Step 3: Verify with Playwright**

```js
() => !!document.getElementById('clan-no-clan-state') && !!document.getElementById('clan-in-clan-state')
```
Expected: `true`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add Clan hub-section HTML skeleton"
```

---

### Task 7: Wire the "not in a clan" state - Create + Join

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `CloudSync.createClan/fetchClanByName/joinClan` (Tasks 3-4), `this._cloudUid`, `this.settings.nickname`.
- Produces: `_openClanSection()`, `_refreshClanUi()` - called whenever the Hub panel opens (wired in Task 9) and after any clan action completes.

- [ ] **Step 1: Capture the new DOM elements**

Find where other Hub-panel elements are captured in the constructor (search for `this.difficultyRow = document.getElementById` as a nearby anchor) and add:

```js
    this.clanSigninGate = document.getElementById('clan-signin-gate')
    this.clanSigninGateText = document.getElementById('clan-signin-gate-text')
    this.clanNoClanState = document.getElementById('clan-no-clan-state')
    this.clanInClanState = document.getElementById('clan-in-clan-state')
    this.clanCreateNameInput = document.getElementById('clan-create-name-input')
    this.clanCreateTagInput = document.getElementById('clan-create-tag-input')
    this.clanCreateBtn = document.getElementById('clan-create-btn')
    this.clanCreateTakenWarning = document.getElementById('clan-create-taken-warning')
    this.clanJoinNameInput = document.getElementById('clan-join-name-input')
    this.clanJoinBtn = document.getElementById('clan-join-btn')
    this.clanJoinStatus = document.getElementById('clan-join-status')
```

- [ ] **Step 2: Wire Create**

Add a new method (near other Hub-related methods):

```js
  _bindClanSection() {
    if (this.clanCreateBtn) {
      this.clanCreateBtn.addEventListener('click', async () => {
        if (!this._cloudUid) return
        const name = this.clanCreateNameInput.value.trim()
        const tag = this.clanCreateTagInput.value.trim().toUpperCase()
        if (!name || !tag) return
        const existing = await CloudSync.fetchClanByName(name).catch(() => null)
        if (existing) {
          this.clanCreateTakenWarning.textContent = t('clanNameTakenWarning')
          this.clanCreateTakenWarning.style.display = 'block'
          return
        }
        this.clanCreateTakenWarning.style.display = 'none'
        const nickname = this.settings.nickname || t('playerShowcaseTitleDefault')
        const clanId = await CloudSync.createClan(this._cloudUid, nickname, name, tag).catch(() => null)
        if (!clanId) return
        this.settings.clanId = clanId
        this._myClanTag = tag
        saveSettings(this.settings)
        this._refreshClanUi()
      })
    }

    if (this.clanJoinBtn) {
      this.clanJoinBtn.addEventListener('click', async () => {
        if (!this._cloudUid) return
        const name = this.clanJoinNameInput.value.trim()
        if (!name) return
        const clan = await CloudSync.fetchClanByName(name).catch(() => null)
        if (!clan) {
          this.clanJoinStatus.textContent = t('clanNotFound')
          this.clanJoinStatus.style.display = 'block'
          return
        }
        const nickname = this.settings.nickname || t('playerShowcaseTitleDefault')
        const result = await CloudSync.joinClan(clan.clanId, this._cloudUid, nickname).catch(() => ({ ok: false, reason: 'error' }))
        if (!result.ok) {
          this.clanJoinStatus.textContent = result.reason === 'full' ? t('clanFull') : t('clanJoinError')
          this.clanJoinStatus.style.display = 'block'
          return
        }
        this.clanJoinStatus.style.display = 'none'
        this.settings.clanId = clan.clanId
        this._myClanTag = clan.tag
        saveSettings(this.settings)
        this._refreshClanUi()
      })
    }
  }
```

Call `this._bindClanSection()` once from wherever the other Hub-panel binding methods are called in the constructor (search for an existing `this._bindHub()`-style call, or add right after `this._bindHotbar()`).

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Commit**

```bash
git add src/game/Game.js
git commit -m "Wire Clan section: create and join-by-name"
```

---

### Task 8: `_refreshClanUi()` - the state-reconciliation method

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `CloudSync.fetchClanMembers/fetchClanCombinedStats` (Tasks 3-4), `settings.clanId` (Task 2).
- Produces: `_refreshClanUi()` - the single source of truth for which of the two UI states (`clan-no-clan-state` / `clan-in-clan-state`) is shown, and what's in it. Called on Hub panel open (Task 9) and after every create/join/leave/kick action.

- [ ] **Step 1: Add `fetchClanById` to CloudSync.js**

`_refreshClanUi()` (Step 2 below) needs to look up a clan by its id (not a name search) to get its name/tag/leaderId. In `src/game/CloudSync.js`, near `fetchClanByName`:

```js
export async function fetchClanById(clanId) {
  const { db, fsMod } = await ensureApp()
  const snap = await fsMod.getDoc(fsMod.doc(db, 'clans', clanId))
  return snap.exists() ? { ...snap.data(), clanId: snap.id } : null
}
```

- [ ] **Step 2: Implement `_refreshClanUi()`**

```js
  async _refreshClanUi() {
    if (!this.clanSigninGate) return
    if (!this._cloudUid || !CloudSync.isConfigured()) {
      this.clanSigninGate.style.display = 'block'
      this.clanSigninGateText.textContent = t('clanSigninRequired')
      this.clanNoClanState.style.display = 'none'
      this.clanInClanState.style.display = 'none'
      return
    }
    this.clanSigninGate.style.display = 'none'

    if (!this.settings.clanId) {
      this.clanNoClanState.style.display = 'block'
      this.clanInClanState.style.display = 'none'
      return
    }

    // Reconciliation: settings.clanId is a local cache (see spec) - a
    // live members-subcollection check is the actual source of truth,
    // since it can drift (kicked while offline, left on another device).
    const members = await CloudSync.fetchClanMembers(this.settings.clanId).catch(() => [])
    const stillAMember = members.some((m) => m.uid === this._cloudUid)
    if (!stillAMember) {
      this.settings.clanId = null
      this._myClanTag = null
      saveSettings(this.settings)
      this.clanNoClanState.style.display = 'block'
      this.clanInClanState.style.display = 'none'
      return
    }

    this.clanNoClanState.style.display = 'none'
    this.clanInClanState.style.display = 'block'

    const clan = await CloudSync.fetchClanById(this.settings.clanId).catch(() => null)
    if (!clan) return
    this._myClanTag = clan.tag

    this.clanDisplayName.textContent = clan.name
    this.clanDisplayTag.textContent = `[${clan.tag}]`

    const stats = await CloudSync.fetchClanCombinedStats(this.settings.clanId).catch(() => ({ memberCount: members.length, totalKills: 0, totalBestNight: 0 }))
    this.clanStatsMembers.textContent = t('clanStatsMembers', { n: stats.memberCount })
    this.clanStatsKills.textContent = t('clanStatsKills', { n: stats.totalKills })
    this.clanStatsNight.textContent = t('clanStatsNight', { n: stats.totalBestNight })

    const isLeader = clan.leaderId === this._cloudUid
    this.clanMemberList.innerHTML = members.map((m) => `
      <div class="clan-member-row">
        <span>${_escapeHtml(m.nickname)}${m.uid === clan.leaderId ? ` ${t('clanLeaderBadge')}` : ''}</span>
        ${isLeader && m.uid !== clan.leaderId ? `<button type="button" class="clan-kick-btn" data-uid="${m.uid}">${t('clanKickBtn')}</button>` : ''}
      </div>
    `).join('')

    const otherMembersPresent = members.length > 1
    this.clanLeaveBtn.disabled = isLeader && otherMembersPresent
    this.clanLeaveBtn.textContent = isLeader ? t('clanDisbandBtn') : t('clanLeaveBtn')
    this.clanLeaveDisabledHint.style.display = isLeader && otherMembersPresent ? 'block' : 'none'
    if (this.clanLeaveDisabledHint.style.display === 'block') this.clanLeaveDisabledHint.textContent = t('clanLeaderMustKickFirst')
  }
```

- [ ] **Step 3: Capture the remaining DOM elements this method reads**

Add alongside Task 7's element captures:

```js
    this.clanDisplayName = document.getElementById('clan-display-name')
    this.clanDisplayTag = document.getElementById('clan-display-tag')
    this.clanStatsMembers = document.getElementById('clan-stats-members')
    this.clanStatsKills = document.getElementById('clan-stats-kills')
    this.clanStatsNight = document.getElementById('clan-stats-night')
    this.clanMemberList = document.getElementById('clan-member-list')
    this.clanLeaveBtn = document.getElementById('clan-leave-btn')
    this.clanLeaveDisabledHint = document.getElementById('clan-leave-disabled-hint')
```

- [ ] **Step 4: Build check**

Run: `npx vite build`

- [ ] **Step 5: Commit**

```bash
git add src/game/Game.js src/game/CloudSync.js
git commit -m "Add _refreshClanUi() reconciliation method and fetchClanById"
```

---

### Task 9: Wire Leave/Disband + Kick, hook into Hub panel open

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `CloudSync.leaveClan/kickClanMember` (Task 4), `_refreshClanUi()` (Task 8).

- [ ] **Step 1: Wire the Leave/Disband button**

Add to `_bindClanSection()` (Task 7):

```js
    if (this.clanLeaveBtn) {
      this.clanLeaveBtn.addEventListener('click', async () => {
        if (!this._cloudUid || !this.settings.clanId) return
        await CloudSync.leaveClan(this.settings.clanId, this._cloudUid).catch(() => {})
        this.settings.clanId = null
        this._myClanTag = null
        saveSettings(this.settings)
        this._refreshClanUi()
      })
    }
```

- [ ] **Step 2: Wire Kick (event delegation, since kick buttons are re-rendered each refresh)**

```js
    if (this.clanMemberList) {
      this.clanMemberList.addEventListener('click', async (e) => {
        const btn = e.target.closest('.clan-kick-btn')
        if (!btn || !this.settings.clanId) return
        await CloudSync.kickClanMember(this.settings.clanId, btn.dataset.uid).catch(() => {})
        this._refreshClanUi()
      })
    }
```

- [ ] **Step 3: Call `_refreshClanUi()` on Hub panel open**

Find the Hub panel's open method (search for `_openHubPanel` or wherever `hubPanel.style.display` is set to show it). Add `this._refreshClanUi()` right there (fire-and-forget - it's async but the panel shouldn't block opening on this).

- [ ] **Step 4: Build check**

Run: `npx vite build`

- [ ] **Step 5: Verify with Playwright (wiring-level, no live Firestore)**

```js
() => {
  const g = window.__game
  return {
    hasBindMethod: typeof g._bindClanSection === 'function',
    hasRefreshMethod: typeof g._refreshClanUi === 'function',
    leaveBtnExists: !!g.clanLeaveBtn,
    kickDelegationExists: !!g.clanMemberList,
  }
}
```
Expected: all `true`.

- [ ] **Step 6: Commit**

```bash
git add src/game/Game.js
git commit -m "Wire Leave/Disband/Kick, refresh clan UI on Hub panel open"
```

---

### Task 10: Clan tag in leaderboard rows

**Files:**
- Modify: `src/game/Game.js`

**Interfaces:**
- Consumes: `clanTag` field on rows returned by `CloudSync.fetchTopLeaderboard`/`subscribeTopLeaderboard` (already flows through automatically once Task 5 writes it - no CloudSync changes needed, those functions already return whatever fields exist on each doc).

- [ ] **Step 1: Update `_renderLeaderboardRows`**

Find `_renderLeaderboardRows(rows)` (re-read fresh - was around Game.js:11101). It currently builds each row's name with `_escapeHtml(r.name || '???')`. Change every occurrence of that exact expression within this method to:

```js
${r.clanTag ? `[${_escapeHtml(r.clanTag)}] ` : ''}${_escapeHtml(r.name || '???')}
```

(Re-read the method fresh first - it builds a few different row variants for achievements/weekly modes in the same function per the earlier grep results; apply this to each one that renders a player name, not just the first.)

- [ ] **Step 2: Build check**

Run: `npx vite build`

- [ ] **Step 3: Commit**

```bash
git add src/game/Game.js
git commit -m "Show [TAG] badge next to names in leaderboard rows"
```

---

### Task 11: i18n labels

**Files:**
- Modify: `src/game/i18n.js`
- Modify: `src/game/Game.js` (`_updateTexts()`)

**Interfaces:**
- Produces: every `t('clan...')` key referenced in Tasks 7-8.

- [ ] **Step 1: Add the English labels**

In `src/game/i18n.js`'s English block, near other short UI strings:

```js
    clanSigninRequired: 'Sign in via Cloud Save to join or create a clan.',
    clanNameTakenWarning: 'A clan with that name already exists - you can still create yours, or search for it above to join instead.',
    clanNotFound: 'No clan found with that name.',
    clanFull: 'That clan is full (15/15 members).',
    clanJoinError: 'Could not join - try again.',
    clanStatsMembers: '{n} members',
    clanStatsKills: '{n} combined kills',
    clanStatsNight: '{n} combined best nights',
    clanLeaderBadge: '(Leader)',
    clanKickBtn: 'Kick',
    clanLeaveBtn: 'Leave Clan',
    clanDisbandBtn: 'Disband Clan',
    clanLeaderMustKickFirst: 'As leader, kick everyone else before leaving (or disband once you\'re the last member).',
```

- [ ] **Step 2: Update the static labels in `_updateTexts()`**

The only ones needing `_updateTexts()` wiring are static (non-dynamic) labels already present in the HTML at load - `clan-signin-gate-text` and the button default labels are all set dynamically by `_refreshClanUi()`/the click handlers already (Tasks 7-8), so no static `_updateTexts()` entries are needed beyond what those methods already handle live. Skip this step - noted explicitly so it isn't mistaken for a gap.

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Commit**

```bash
git add src/game/i18n.js
git commit -m "Add Clan section i18n labels"
```

---

### Task 12: Full wiring verification pass

**Files:**
- No source changes - verification only.

- [ ] **Step 1: Verify the full UI state machine with mocked CloudSync data**

Since a live Firestore round-trip needs a real second signed-in test account (out of scope per the spec's own Testing section), verify what's actually checkable: stub `CloudSync`'s exported functions in a `page.evaluate()` (e.g. temporarily reassign `window.__game` isn't how ES module imports work, so instead verify via direct method calls with injected fake data - call `game._refreshClanUi()` after manually setting `game.settings.clanId` and manually monkey-patching a couple of the imported `CloudSync` functions isn't directly reachable from `page.evaluate()` either, since they're module-scoped imports, not globals).

Given that constraint, the realistic verification for this task is: confirm the sign-in gate shows correctly when `_cloudUid` is unset, confirm the no-clan state shows when signed in with no `clanId`, and confirm all the button click handlers are real functions attached (already covered in Task 9 Step 5) - which is the honest ceiling of what Playwright can verify here without live Firestore. Write this as one script:

```js
() => {
  const g = window.__game
  g._cloudUid = null
  g._refreshClanUi()
  const signedOutState = document.getElementById('clan-signin-gate').style.display
  g._cloudUid = 'fake-test-uid'
  g.settings.clanId = null
  // _refreshClanUi is async and would try a real network call past this
  // point if clanId were set - stop here, which is exactly the boundary
  // this task's Files note describes.
  const stillHasSigninGateLogic = typeof g._refreshClanUi === 'function'
  return { signedOutState, stillHasSigninGateLogic }
}
```

Expected: `signedOutState: 'block'`, `stillHasSigninGateLogic: true`.

- [ ] **Step 2: Record what this does NOT prove**

Note (for the final report to Gaymi, not a new file): create/join/leave/kick's actual Firestore round-trips, the membership cap, and the combined-stats aggregation are all unverified by automated testing - they need a real signed-in Cloud Save account (and ideally two, to test join/kick from both sides) to confirm end-to-end. This should be stated plainly, not glossed over, matching this session's established honesty precedent for anything that needs infrastructure neither Gaymi nor this environment has in hand.

---

### Task 13: Deploy Firestore rules, build, commit, push, deploy

**Files:**
- No source changes beyond what's already committed.

- [ ] **Step 1: Final production build check**

Run: `npx vite build`
Expected: clean build.

- [ ] **Step 2: Push to GitHub**

```bash
git push origin main
```

- [ ] **Step 3: Deploy to Vercel production**

```bash
npx vercel --prod --yes
```

- [ ] **Step 4: Report the manual Firestore Console step clearly to Gaymi**

This is the one piece of this feature that genuinely cannot be automated from here: the updated `FIRESTORE_SECURITY_RULES` string (now including the `clans`/`clans/members` blocks and the extended `leaderboard` rule) needs to be copy-pasted into Firebase Console's Firestore Rules tab by hand, replacing whatever's currently there (per this project's own standing note - it's the FULL ruleset, not a diff). Until that happens, every clan create/join/leave/kick call will fail with a permissions error even though the code is deployed and correct - this needs calling out explicitly and simply, with the exact navigation path (Firebase Console → the `gayz-aa69c` project → Firestore Database → Rules tab), not left implicit.
