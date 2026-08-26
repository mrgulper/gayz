# Community Builds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players publish their Build Mode creation to a shared public catalog and download other players' published builds, reusing Build Mode's existing save format and Import path rather than inventing anything new.

**Architecture:** One new Firestore collection (`communityBuilds/{buildId}`) plus a `reports/{uid}` subcollection (doc-id-equals-own-uid, mirroring the existing `polls/{pollId}/votes/{userId}` pattern). `BuildMode` gets a reference to the `Game` instance at construction (it currently has none) so it can reach `game._cloudUid`/`game.settings.nickname`, matching this project's established "pass the whole game object" convention. UI lives in two new `#build-menu` buttons plus a new standalone Browse panel, following the exact same panel pattern the Clan panel already established earlier this session.

**Tech Stack:** Firebase Auth + Firestore (via `src/game/CloudSync.js`, already integrated), vanilla JS/DOM, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-community-builds-design.md`

## Global Constraints

- `communityBuilds/{buildId}/reports/{uid}` records reports but nothing reads them automatically - no counter field anywhere, no auto-hide. The spec's own self-review explicitly rejected a writable `reportCount` field after finding it let one account inflate it arbitrarily - do not reintroduce it.
- 5,000-block cap per published build, enforced both client-side (before attempting to publish) and in the security rule.
- `BuildMode.js` currently has zero i18n usage (confirmed via fresh grep - no `import ... from './i18n.js'` anywhere in the file) - new UI here uses plain English text directly in the HTML, matching this file's own existing convention, not `t()`.
- `importMapFile()` currently clears the in-progress build with NO confirmation dialog at all (confirmed via fresh read - straight to `this.clearAllBlocks()`) - Download must match this exact existing behavior for consistency, not introduce a new confirm step only for itself.
- Fresh-read discipline: re-read actual current file content before every edit - line numbers cited below were confirmed fresh while writing this plan but files may shift.
- Build check (`npx vite build`) after every task, commit after every task. Push + deploy only in the final task.

---

### Task 1: Firestore security rules

**Files:**
- Modify: `src/game/CloudSync.js` (`FIRESTORE_SECURITY_RULES` export)

**Interfaces:**
- Produces: the ruleset every later task's Firestore calls depend on being correct (not deployable by this plan itself - Firebase Console access is a manual step, called out in the final task).

- [ ] **Step 1: Add the two new `match` blocks**

Find `FIRESTORE_SECURITY_RULES` (search for `export const FIRESTORE_SECURITY_RULES`). Inside `match /databases/{database}/documents {`, add (verbatim from the spec):

```
    match /communityBuilds/{buildId} {
      allow read: if true;
      allow create: if request.auth != null
        && request.resource.data.creatorUid == request.auth.uid
        && request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 24
        && request.resource.data.creatorNickname is string && request.resource.data.creatorNickname.size() > 0 && request.resource.data.creatorNickname.size() <= 16
        && request.resource.data.blocks is list && request.resource.data.blocks.size() <= 5000
        && request.resource.data.hotbar is list
        && request.resource.data.blockCount is int && request.resource.data.blockCount == request.resource.data.blocks.size()
        && request.resource.data.createdAt is int;
      allow update: if request.auth != null && request.auth.uid == resource.data.creatorUid
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['name'])
        && request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 24;
      allow delete: if request.auth != null && request.auth.uid == resource.data.creatorUid;
    }

    match /communityBuilds/{buildId}/reports/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow create: if request.auth != null && request.auth.uid == uid
        && request.resource.data.reportedAt is int;
      allow update, delete: if false;
    }
```

- [ ] **Step 2: Build check**

Run: `npx vite build`
Expected: no errors (plain string change).

- [ ] **Step 3: Commit**

```bash
git add src/game/CloudSync.js
git commit -m "Add communityBuilds/reports Firestore rules"
```

---

### Task 2: CloudSync.js functions - publish, browse, report

**Files:**
- Modify: `src/game/CloudSync.js`

**Interfaces:**
- Consumes: `ensureApp()` (existing).
- Produces: `publishBuild(uid, nickname, name, blocks, hotbar)`, `fetchCommunityBuilds()`, `reportBuild(buildId, uid)` - used by Tasks 4-6.

- [ ] **Step 1: Add `publishBuild`**

Add near the other write functions (e.g. after the clan functions):

```js
// Community Builds (share Build Mode maps - see
// docs/superpowers/specs/2026-08-26-community-builds-design.md).
// blockCount is denormalized from blocks.length so the Browse list can
// show it without downloading the full block array per row.
const COMMUNITY_BUILD_BLOCK_CAP = 5000

export async function publishBuild(uid, nickname, name, blocks, hotbar) {
  if (blocks.length > COMMUNITY_BUILD_BLOCK_CAP) return { ok: false, reason: 'tooLarge' }
  const { db, fsMod } = await ensureApp()
  const buildRef = fsMod.doc(fsMod.collection(db, 'communityBuilds'))
  await fsMod.setDoc(buildRef, {
    name,
    creatorUid: uid,
    creatorNickname: nickname,
    blocks,
    hotbar,
    blockCount: blocks.length,
    createdAt: Date.now(),
  })
  return { ok: true, buildId: buildRef.id }
}
```

- [ ] **Step 2: Add `fetchCommunityBuilds`**

Mirrors `fetchAllClans`'s exact pattern (newest first, capped at 50):

```js
export async function fetchCommunityBuilds() {
  const { db, fsMod } = await ensureApp()
  const q = fsMod.query(fsMod.collection(db, 'communityBuilds'), fsMod.orderBy('createdAt', 'desc'), fsMod.limit(50))
  const snap = await fsMod.getDocs(q)
  return snap.docs.map((d) => ({ ...d.data(), buildId: d.id }))
}
```

- [ ] **Step 3: Add `reportBuild`**

A single write, no counter anywhere (per the spec's corrected design):

```js
export async function reportBuild(buildId, uid) {
  const { db, fsMod } = await ensureApp()
  await fsMod.setDoc(fsMod.doc(db, 'communityBuilds', buildId, 'reports', uid), { reportedAt: Date.now() })
}
```

- [ ] **Step 4: Build check**

Run: `npx vite build`

- [ ] **Step 5: Commit**

```bash
git add src/game/CloudSync.js
git commit -m "Add publishBuild/fetchCommunityBuilds/reportBuild to CloudSync"
```

---

### Task 3: Thread the `Game` instance into `BuildMode`

**Files:**
- Modify: `src/game/BuildMode.js`
- Modify: `src/game/Game.js`

**Interfaces:**
- Produces: `this.game` on the `BuildMode` instance - `game._cloudUid` and `game.settings.nickname` are what Tasks 4-6 need to call the CloudSync functions from Task 2.

**Why this task exists:** re-reading `BuildMode.js`'s constructor fresh (`constructor(renderer)`) confirmed it has no reference to `Game` at all today - Publish/Browse/Report need the signed-in uid and nickname, which only `Game` currently holds.

- [ ] **Step 1: Add the parameter**

Find `constructor(renderer)` in `BuildMode.js` (re-read fresh, was around line 699). Change to:

```js
  constructor(renderer, game) {
    this.game = game
```

(keep every existing line after it unchanged - this just adds the one new parameter and field, at the very top of the constructor body).

- [ ] **Step 2: Pass it from `Game.js`**

Find `this.buildMode = new BuildMode(this.renderer)` in `_enterBuildMode()` (re-read fresh, was around line 11945). Change to:

```js
      this.buildMode = new BuildMode(this.renderer, this)
```

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Verify with Playwright**

```js
() => {
  const g = window.__game
  return { hasGameRef: !!g.buildMode && (typeof g.buildMode.enter !== 'function' || g.buildMode.game === g) }
}
```

(Build Mode's real class is lazy-loaded on first entry - re-reading `_enterBuildMode` fresh confirmed `this.buildMode` starts as a placeholder object with no `.enter` method until first entered. This check tolerates either state without needing to actually enter Build Mode, which needs pointer lock and isn't reliable in headless Playwright per this project's own documented gotcha.)

- [ ] **Step 5: Commit**

```bash
git add src/game/BuildMode.js src/game/Game.js
git commit -m "Thread the Game instance into BuildMode so it can reach the signed-in uid/nickname"
```

---

### Task 4: `#build-menu` HTML - Publish and Browse buttons + Browse panel skeleton

**Files:**
- Modify: `index.html`

**Interfaces:**
- Produces: the static DOM Tasks 5-7 attach behavior to.

- [ ] **Step 1: Add the two buttons to `#build-menu`**

Find `#build-menu` (re-read fresh, was around index.html:65-75). Add two buttons, right before the existing Exit button:

```html
        <button id="build-mode-publish-btn">Publish Build</button>
        <button id="build-mode-browse-btn">Browse Community Builds</button>
        <button id="build-mode-exit-btn">Exit Map Editor</button>
```

(Plain English labels, matching every other button in this menu - `#build-menu` has no i18n wiring anywhere, confirmed via fresh grep, so this file's own convention is followed, not the rest of the game's `t()` pattern.)

- [ ] **Step 2: Add the Browse panel**

Add as a sibling of `#build-menu` (same top-level nesting, right after it):

```html
      <div id="community-builds-panel" style="display: none">
        <h2>Community Builds</h2>
        <div id="community-builds-list"></div>
        <p id="community-builds-empty" style="display: none">No builds published yet - be the first!</p>
        <button id="community-builds-close-btn">Close</button>
      </div>
```

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Verify with Playwright**

```js
() => !!document.getElementById('build-mode-publish-btn') && !!document.getElementById('build-mode-browse-btn') && !!document.getElementById('community-builds-panel')
```
Expected: `true`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Publish/Browse buttons and the Community Builds panel skeleton"
```

---

### Task 5: Wire Publish

**Files:**
- Modify: `src/game/BuildMode.js`

**Interfaces:**
- Consumes: `CloudSync.publishBuild` (Task 2), `this._snapshot()` (existing), `this.game._cloudUid`/`this.game.settings.nickname` (Task 3).
- Produces: `_bindCommunityBuilds()` - called once from the constructor, alongside wherever the existing menu buttons already get their click listeners wired (find that spot fresh rather than assuming a specific line).

- [ ] **Step 1: Import CloudSync**

Add near the top of `BuildMode.js`:

```js
import * as CloudSync from './CloudSync.js'
```

- [ ] **Step 2: Capture the new elements and wire Publish**

Find wherever `#build-mode-export-btn`/`#build-mode-import-btn` currently get captured and bound (re-read fresh to find the exact existing pattern in this file - it's a constructor-time `document.getElementById` + `addEventListener` pair, matching this class's own established style). Add alongside it:

```js
    this._communityBuildsPublishBtn = document.getElementById('build-mode-publish-btn')
    this._communityBuildsBrowseBtn = document.getElementById('build-mode-browse-btn')
    this._communityBuildsPanel = document.getElementById('community-builds-panel')
    this._communityBuildsList = document.getElementById('community-builds-list')
    this._communityBuildsEmpty = document.getElementById('community-builds-empty')
    this._communityBuildsCloseBtn = document.getElementById('community-builds-close-btn')
    this._bindCommunityBuilds()
```

Add the method:

```js
  _bindCommunityBuilds() {
    if (this._communityBuildsPublishBtn) {
      this._communityBuildsPublishBtn.addEventListener('click', async () => {
        if (!this.game || !this.game._cloudUid) return
        const name = window.prompt('Name this build:')
        if (!name || !name.trim()) return
        const snapshot = this._snapshot()
        if (snapshot.blocks.length > 5000) {
          window.alert('This build has too many blocks to publish (max 5,000).')
          return
        }
        const nickname = this.game.settings.nickname || 'Player'
        const result = await CloudSync.publishBuild(this.game._cloudUid, nickname, name.trim(), snapshot.blocks, snapshot.hotbar).catch(() => ({ ok: false }))
        window.alert(result.ok ? 'Build published!' : 'Could not publish - try again.')
      })
    }
  }
```

(`window.prompt`/`window.alert` match this file's existing plain-browser-dialog convention rather than a styled in-game modal, since Build Mode has no toast/modal system of its own today - re-read the file fresh to confirm this before assuming a styled alternative exists; if it does, use that instead of `prompt`/`alert`.)

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Commit**

```bash
git add src/game/BuildMode.js
git commit -m "Wire Publish Build to CloudSync.publishBuild"
```

---

### Task 6: Wire Browse (render the list, click-outside-to-close)

**Files:**
- Modify: `src/game/BuildMode.js`

**Interfaces:**
- Consumes: `CloudSync.fetchCommunityBuilds` (Task 2).
- Produces: `_openCommunityBuildsPanel()`, `_closeCommunityBuildsPanel()`.

- [ ] **Step 1: Implement open/close + list rendering**

Add to `_bindCommunityBuilds()` (Task 5):

```js
    if (this._communityBuildsBrowseBtn) {
      this._communityBuildsBrowseBtn.addEventListener('click', () => this._openCommunityBuildsPanel())
    }
    if (this._communityBuildsCloseBtn) {
      this._communityBuildsCloseBtn.addEventListener('click', () => this._closeCommunityBuildsPanel())
    }
    if (this._communityBuildsPanel) {
      this._communityBuildsPanel.addEventListener('click', (e) => {
        if (e.target === this._communityBuildsPanel) this._closeCommunityBuildsPanel()
      })
    }
```

Add the methods. `_fetchedCommunityBuilds` caches the full fetched list
(including each build's `blocks`/`hotbar`) so Task 7's Download handler
can read the full data straight from it instead of re-fetching per click:

```js
  async _openCommunityBuildsPanel() {
    if (!this._communityBuildsPanel) return
    this._communityBuildsPanel.style.display = 'flex'
    this._fetchedCommunityBuilds = await CloudSync.fetchCommunityBuilds().catch(() => [])
    this._communityBuildsEmpty.style.display = this._fetchedCommunityBuilds.length ? 'none' : 'block'
    this._communityBuildsList.innerHTML = this._fetchedCommunityBuilds.map((b) => `
      <div class="community-build-row">
        <span>${_escapeHtmlBuildMode(b.name)} - ${_escapeHtmlBuildMode(b.creatorNickname)} (${b.blockCount} blocks)</span>
        <button type="button" class="community-build-download-btn" data-build-id="${b.buildId}">Download</button>
        <button type="button" class="community-build-report-btn" data-build-id="${b.buildId}">Report</button>
      </div>
    `).join('')
  }

  _closeCommunityBuildsPanel() {
    if (this._communityBuildsPanel) this._communityBuildsPanel.style.display = 'none'
  }
```

- [ ] **Step 2: Add the small HTML-escape helper**

`BuildMode.js` has no existing `_escapeHtml`-equivalent (unlike `Game.js`'s `_escapeHtml`) - re-read the file fresh to confirm this before adding a duplicate. If it genuinely doesn't exist, add a small module-level function near the top of the file:

```js
function _escapeHtmlBuildMode(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}
```

(Named distinctly from `Game.js`'s `_escapeHtml` since this is a different module-level function, not importing across files for one tiny helper - matches this project's general preference for keeping small utilities local rather than adding a shared-utils module for one function.)

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Verify with Playwright**

```js
() => {
  const g = window.__game
  return { hasOpenMethod: typeof g.buildMode.enter === 'function' ? typeof g.buildMode._openCommunityBuildsPanel === 'function' : 'buildmode-not-yet-entered' }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/game/BuildMode.js
git commit -m "Wire Browse Community Builds: list rendering, open/close, click-outside-to-close"
```

---

### Task 7: Wire Download and Report

**Files:**
- Modify: `src/game/BuildMode.js`

**Interfaces:**
- Consumes: `this._fetchedCommunityBuilds` (Task 6 - the cached list including each build's full `blocks`/`hotbar`, avoiding a second fetch per Download click), `CloudSync.reportBuild` (Task 2), `this.clearAllBlocks()`/`this._applyParsedData()`/`this._ensureGroundLayer()`/`this.save()` (existing, same sequence `importMapFile` already uses).

- [ ] **Step 1: Wire Download and Report (event delegation on the list)**

Add to `_bindCommunityBuilds()`:

```js
    if (this._communityBuildsList) {
      this._communityBuildsList.addEventListener('click', async (e) => {
        const downloadBtn = e.target.closest('.community-build-download-btn')
        const reportBtn = e.target.closest('.community-build-report-btn')
        if (downloadBtn) {
          const build = (this._fetchedCommunityBuilds || []).find((b) => b.buildId === downloadBtn.dataset.buildId)
          if (!build) return
          // Same clear-then-apply sequence importMapFile() already uses,
          // with no confirmation dialog - matching that existing behavior
          // exactly rather than introducing a new confirm step only here.
          this.clearAllBlocks()
          this._applyParsedData({ blocks: build.blocks, hotbar: build.hotbar })
          this._ensureGroundLayer()
          this.save()
          this._closeCommunityBuildsPanel()
        } else if (reportBtn) {
          if (!this.game || !this.game._cloudUid) return
          await CloudSync.reportBuild(reportBtn.dataset.buildId, this.game._cloudUid).catch(() => {})
          reportBtn.textContent = 'Reported'
          reportBtn.disabled = true
        }
      })
    }
```

- [ ] **Step 2: Build check**

Run: `npx vite build`

- [ ] **Step 3: Commit**

```bash
git add src/game/BuildMode.js
git commit -m "Wire Download (reusing the existing import path) and Report"
```

---

### Task 8: CSS for the Community Builds panel and rows

**Files:**
- Modify: `src/style.css`

**Interfaces:**
- Consumes: nothing new.
- Produces: visual styling for `#community-builds-panel` and `.community-build-row`.

- [ ] **Step 1: Check whether `#build-menu` already has a styled-overlay CSS pattern to mirror**

Re-read `src/style.css` fresh for `#build-menu`'s own rule (search `#build-menu {`) - Build Mode's panels use their own visual language, separate from the main menu's gold-plate panels (confirmed by `BuildMode.js` having no i18n or shared-panel-class usage). Match whatever styling convention `#build-menu` itself already uses (background/border/font) for `#community-builds-panel`, rather than importing the unrelated `.clan-list-row`-style tokens from a different part of the game.

- [ ] **Step 2: Add the CSS**

```css
#community-builds-panel {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  padding: 24px;
}

#community-builds-list {
  width: min(500px, 90vw);
  max-height: 60vh;
  overflow-y: auto;
}

.community-build-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  margin-bottom: 6px;
}
```

(Re-adjust the exact colors/z-index after Step 1's check if `#build-menu` already establishes a different convention - this is a starting point, not a value to apply blindly over whatever's actually there.)

- [ ] **Step 3: Build check**

Run: `npx vite build`

- [ ] **Step 4: Commit**

```bash
git add src/style.css
git commit -m "Add Community Builds panel styling"
```

---

### Task 9: Full wiring verification pass

**Files:**
- No source changes - verification only.

- [ ] **Step 1: Verify what CAN be verified without a live account**

Same honesty boundary as every other Cloud-Save-dependent feature this session - no live two-account publish-then-download round trip (needs a real signed-in account). Verify instead:

```js
() => {
  const g = window.__game
  return {
    publishBtnExists: !!document.getElementById('build-mode-publish-btn'),
    browseBtnExists: !!document.getElementById('build-mode-browse-btn'),
    panelExists: !!document.getElementById('community-builds-panel'),
  }
}
```

If Build Mode has already been entered at least once this session (its real class lazy-loads on first entry - see Task 3's own note), also verify:

```js
() => {
  const g = window.__game
  const bm = g.buildMode
  if (typeof bm.enter !== 'function') return { notYetEntered: true }
  return {
    hasGameRef: bm.game === g,
    hasBindMethod: typeof bm._bindCommunityBuilds === 'function',
    hasOpenMethod: typeof bm._openCommunityBuildsPanel === 'function',
  }
}
```

Expected: all `true` (or `{ notYetEntered: true }` if Build Mode was never entered in this test run - real entry needs pointer lock, which this project's own CLAUDE.md documents as unreliable in headless Playwright, so don't force it just to satisfy this check).

- [ ] **Step 2: Record what this does NOT prove**

Note for the final report to Gaymi: a real publish → appears in Browse → download → blocks actually placed round trip needs a real signed-in account (ideally two, to also test Report from a different account than the publisher) to confirm end-to-end - stated plainly, not glossed over.

---

### Task 10: Deploy Firestore rules, build, commit, push, deploy

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

Same as every other rules change tonight - the updated `FIRESTORE_SECURITY_RULES` string (now including the `communityBuilds`/`reports` blocks) needs a fresh copy-paste into Firebase Console's Firestore Rules tab (Firestore Database → Rules, not Realtime Database - re-state this distinction plainly, since it tripped Gaymi up during the Clan system rollout), replacing the whole ruleset. Until that happens, Publish/Report will fail with a permissions error even though the code is correctly deployed.

- [ ] **Step 5: Update the What's New changelog**

Per the standing project rule (this drifted stale twice already this session before Gaymi had to catch it both times) - add a `.changelog-entry` to `#changelog-list` in `index.html` (top of the list, today's date) describing Community Builds in plain player-facing language, then repeat Steps 1-3 (build, commit, push, deploy) to ship that too. This step is not optional or an afterthought - treat it as part of this same deploy, not a separate task to remember later.
