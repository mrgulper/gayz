# Community Builds (Share Build Mode Maps) - Design

## Context

Gaymi asked to let players upload/download each other's Build Mode
creations, picked from a list of big-feature ideas. Build Mode
("Map Editor" in its own UI - the Exit button reads "Exit Map Editor",
confirming these are the same feature, not two separate systems)
already has almost everything this needs.

## Existing prior art (why this is lower-risk than it sounds)

- **The save format already exists and is small.** `BuildMode.js`'s
  `_snapshot()` returns `{ blocks: [{x,y,z,type}], hotbar: [...] }` -
  a plain list of block placements. Even a large build (thousands of
  placements) stays well under a single Firestore document's ~1MB
  limit, so this needs no new storage service (no Firebase Storage) -
  just the same Firestore database every other online feature tonight
  already uses.
- **Export/Import already round-trip this exact shape.** `exportMap()`
  downloads it as a JSON file; `importMapFile(file)` reads one back in
  via `_applyParsedData()`. Sharing a build already technically works
  today - by manually sending a file to a friend outside the game.
  This feature's whole job is replacing "send a file" with "browse a
  list," not inventing a new save format.
- **The security-rule pattern is the same one used for
  `leaderboard`/`clans` all session**: a public-read collection,
  own-uid-only write for your own docs, field-level validation.

## Approach

**Community Builds catalog** - a new Firestore collection storing
published builds. Build Mode's existing menu (`#build-menu`) gets two
new buttons: **Publish** (uploads your current build) and **Browse**
(opens a list of published builds with a Download button per row,
reusing the existing `_applyParsedData()` import path). Public to
browse; you can only publish/delete your own. A simple **Report**
button per row, given user-generated content now becomes visible to
other players for the first time - lower risk than most UGC since a
build is only ever a fixed-palette block arrangement (`VALID_TYPE_IDS`
already whitelists every block type on import), no free text and no
custom images, but not zero risk (someone could still build something
offensive out of blocks), so a lightweight report mechanism is
included rather than skipped.

## Data Model

- **`communityBuilds/{buildId}`**:
  ```
  { name: string, creatorUid: string, creatorNickname: string, blocks: array, hotbar: array, blockCount: number, createdAt: number }
  ```
  `buildId` is a Firestore auto-generated doc ID. `blockCount` is
  denormalized (computed from `blocks.length` at publish time) so the
  Browse list can show it without downloading the full block array
  for every row. `name` is player-chosen (like a clan name), capped at
  24 characters, no server-enforced uniqueness (same "trusted
  players, don't over-build" posture as clan names).

- **Size cap: 5,000 blocks per published build** (`blocks.length <=
  5000`, enforced both client-side before attempting publish and in
  the security rule itself, since this one - unlike the clan member
  cap - CAN be checked declaratively without a transaction). This
  keeps every document comfortably small (a few hundred KB at most)
  and bounds how much data the Browse list and any single download
  ever have to move, not a creative limitation most builds would ever
  approach.

- **Reports**: `communityBuilds/{buildId}/reports/{uid}` - one report
  doc per reporter per build (doc id = reporter's own uid, capping one
  report per account per build, mirroring the `polls/{pollId}/votes/
  {userId}` one-per-account pattern already used tonight). Deliberately
  NOT a writable counter field on the parent doc - a first draft of
  this spec had a `reportCount` field anyone could increment by 1 per
  write, but that let a single account inflate it arbitrarily by just
  calling the update repeatedly, since nothing tied an increment to an
  actual report doc existing (same shared-mutable-counter trap the
  Clan system's combined stats deliberately avoided). Fixed by not
  storing a count at all: reports are recorded but nothing reads them
  automatically in this pass - no queue, no auto-hide-after-N-reports
  (that would mean re-checking every listed build's report count on
  every Browse page load, an extra query per row for a rarely-used
  safety net). Gaymi reviews `communityBuilds/*/reports` in Firebase
  Console directly if a report ever comes in, and deletes the
  offending build by hand - same "trusted/manual fallback over
  building a full admin panel" precedent as everything else tonight.

## Security Rules

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

The report flow is a single write: create your own `reports/{uid}`
doc (blocked from a second report by the same account, since the doc
id is fixed to your uid and Firestore rejects a second `create` on an
existing doc id). Nothing on the parent `communityBuilds/{buildId}`
doc needs touching at all - the Browse list's live
`getCountFromServer` check reads the reports subcollection directly.

## UI

Two new buttons in the existing `#build-menu`: **Publish** (prompts
for a build name, uploads the current in-progress build - the exact
same `_snapshot()` data `exportMap()` already produces) and **Browse
Community Builds** (opens a new standalone panel, same pattern as the
Clan panel added earlier tonight).

**Browse panel**: a list of published builds (name, creator nickname,
block count, a Download button, a Report button), newest first,
capped at 50 per load (same list-size precedent as the clan directory
and every other list-fetching query tonight). Downloading a build
clears the player's current in-progress build first (same confirm-
before-destructive-action the existing Import already presumably has,
matching Vibecoding Rule B - re-verify `importMapFile`'s own current
behavior before wiring Download the same way, don't assume) and loads
the downloaded one in via the exact same `_applyParsedData()` path
Import already uses.

## Testing

Same honesty precedent as every other Firestore-dependent feature
tonight: Playwright verifies the UI wiring (Publish button calls the
right function with the current build's real snapshot data, Browse
renders a list given injected data, Download actually calls
`_applyParsedData` with the right payload) but not a live two-account
publish-then-download round trip, which needs a real signed-in
account to confirm end-to-end.
