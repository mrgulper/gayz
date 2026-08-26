# Clan System (Lightweight "Crew") - Design

## Context

Gaymi asked for a "Clan" section under the Hub panel's sidebar, and for
design ideas for how a clan system would work. This project's own
history already considered "clans" once before (the round that added
Friends/leaderboards) and deliberately deferred it - it was bundled
with chat/activity-feed/presence and flagged as needing more
moderation/scope than was worth building at the time (see
`zombie-survival-3d/CLAUDE.md`'s "Online Features" section, third
paragraph). This spec is the smallest real slice that avoids reopening
those specific concerns: no chat, no activity feed, no real-time
presence.

Three approaches were presented to Gaymi:
- **A - Lightweight "Crew"**: named group, a tag shown next to your
  name, a combined-stats view aggregated from existing leaderboard
  data. No chat, no roles beyond leader/member, no clan-vs-clan
  ranking.
- **B - Crew + a shared weekly goal**: A, plus a live shared counter
  members contribute to. Real added complexity: safely handling
  multiple members writing to one shared value at once.
- **C - Full clan system**: roles, invites/applications, activity
  feed, clan-vs-clan competition - the version already explicitly
  deferred once before, for real reasons.

**Approach A was chosen.** This spec covers only A.

## Existing prior art (why this is lower-risk than it sounds)

This project already has a real, working multi-user social layer via
Firebase Auth + Firestore (`src/game/CloudSync.js`):
- `leaderboard/{uid}` - one doc per signed-in player, public read, own-
  uid-only write, with per-field type/range validation
  (`FIRESTORE_SECURITY_RULES`).
- `friendRequests/{toUid}/incoming/{fromUid}` - a subcollection keyed
  by the OTHER party's uid, so security rules stay simple: you can
  create a doc in someone else's inbox (send a request) as long as the
  doc id is your own uid, and either side can delete it (accept/
  decline/cancel).
- `weeklyLeaderboard/{week}/entries/{uid}`, `polls/{pollId}/votes/{uid}`
  - same "doc id = your own uid" ownership pattern throughout.

The clan system reuses this exact shape rather than inventing a new
one: clan MEMBERSHIP is a subcollection keyed by the member's own uid
(same trick `friendRequests` already uses), so a member can only ever
create/delete their OWN membership doc - trivial to secure correctly,
no array-diffing or transaction logic needed. Clan STATS are not a new
write-path at all - they're computed by querying the existing
`leaderboard` collection filtered by a new `clanId` field, and summing
client-side. This means the entire feature adds exactly one new field
to an existing collection, one new collection, and one new
subcollection - no new shared-counter system, which is precisely the
piece Approach B would have needed and this spec avoids.

## Data Model

- **`clans/{clanId}`** (public read, leader-only write after creation):
  ```
  { name: string, tag: string, leaderId: string, leaderNickname: string, createdAt: number }
  ```
  `clanId` is a Firestore auto-generated document ID (not a
  player-chosen slug - avoids any need to check uniqueness of the ID
  itself). `tag` is a short 2-4 character badge (e.g. `GAYZ`),
  `name` is the full display name. No server-enforced uniqueness on
  either - if two clans pick the same name, that's allowed, matching
  this project's established "trusted friends, don't over-build"
  posture (same reasoning `Phase 3`'s multiplayer spec used to skip
  heavy anti-cheat). The CREATE UI does a client-side "is this name
  already taken?" query first and warns if so, but doesn't hard-block
  it.

- **`clans/{clanId}/members/{uid}`** (member docs, one per member):
  ```
  { nickname: string, joinedAt: number }
  ```
  Doc ID is the member's own uid. Creating this doc *is* joining;
  deleting it *is* leaving (or being kicked, if the leader deletes
  someone else's).

- **`leaderboard/{uid}`** gains one new optional field: `clanId:
  string`. This is the only change to an existing collection - a
  player's own leaderboard doc already allows arbitrary field updates
  by its own owner within the existing rule's validated field list;
  `clanId` needs adding to that validated list (a plain string,
  matching an existing `clans/{clanId}` doc's real ID - not otherwise
  enforced referentially, since Firestore security rules can't cheaply
  do a cross-collection existence check on every leaderboard write;
  a stale/fake `clanId` just means that player never shows up in any
  clan's aggregated view, which is a benign failure mode, not a
  security problem).

- **Membership cap: 15.** Enforced client-side before attempting to
  join (a `getCountFromServer` count query on the members
  subcollection, same aggregation technique this project's leaderboard
  rank features already use) - keeps the later "sum this clan's
  stats" query cheap and bounded. Not enforced in security rules
  (would need a transaction to be race-proof against two simultaneous
  15th-joiners; a benign 16th member slipping through under a rare
  race is an acceptable, non-security-relevant edge case here, same
  trust posture as the rest of this section).

- **One clan per player, tracked where the player already has a
  natural per-account slot**: `settings.clanId` (local, synced via the
  existing Cloud Save blob - `_snapshotLocalSave()`/
  `_applyImportedSaveData()` already sync arbitrary settings fields,
  no changes needed there) mirrors whichever `clans/{clanId}/members/
  {uid}` doc actually exists for this account - `settings.clanId` is a
  local cache for "which clan am I in" that gets refreshed from a live
  Firestore read on Cloud Save sign-in load and Hub-panel open (not
  trusted for anything security-relevant, since it's just UI-state
  convenience - if it's ever stale, the Hub panel's own live query is
  the source of truth in the next open).

## Security Rules (append to `FIRESTORE_SECURITY_RULES`, `CloudSync.js`)

```
match /clans/{clanId} {
  allow read: if true;
  allow create: if request.auth != null
    && request.resource.data.leaderId == request.auth.uid
    && request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 24
    && request.resource.data.tag is string && request.resource.data.tag.size() > 0 && request.resource.data.tag.size() <= 4
    && request.resource.data.leaderNickname is string && request.resource.data.leaderNickname.size() > 0 && request.resource.data.leaderNickname.size() <= 16
    && request.resource.data.createdAt is int;
  // Only the leader can ever change the clan doc itself (rename/re-tag) -
  // membership changes go through the members subcollection below, not
  // this doc, so this never needs touching for ordinary join/leave.
  allow update: if request.auth != null && request.auth.uid == resource.data.leaderId
    && request.resource.data.leaderId == resource.data.leaderId
    && request.resource.data.name is string && request.resource.data.name.size() > 0 && request.resource.data.name.size() <= 24
    && request.resource.data.tag is string && request.resource.data.tag.size() > 0 && request.resource.data.tag.size() <= 4;
  allow delete: if request.auth != null && request.auth.uid == resource.data.leaderId;
}

match /clans/{clanId}/members/{uid} {
  allow read: if true;
  // Joining: you can only ever create YOUR OWN membership doc.
  allow create: if request.auth != null && request.auth.uid == uid
    && request.resource.data.nickname is string && request.resource.data.nickname.size() > 0 && request.resource.data.nickname.size() <= 16
    && request.resource.data.joinedAt is int;
  // Leaving (your own doc) or being kicked (the clan's leader deletes
  // someone else's) - the leader's identity is read from the parent
  // clans/{clanId} doc, same "look up the parent to authorize a
  // subcollection write" pattern this project hasn't needed before but
  // is standard Firestore rules practice.
  allow delete: if request.auth != null
    && (request.auth.uid == uid || request.auth.uid == get(/databases/$(database)/documents/clans/$(clanId)).data.leaderId);
  allow update: if false;
}
```

And extend the existing `leaderboard/{userId}` rule's validated-field
list with:
```
&& (!('clanId' in request.resource.data) || (request.resource.data.clanId is string && request.resource.data.clanId.size() > 0))
```

**Reminder for whoever runs this**: per this project's own standing
note, `FIRESTORE_SECURITY_RULES` is exported as the FULL ruleset, not
additive - publishing it to Firebase Console's Rules tab always
replaces whatever's currently live there, so the whole updated string
needs pasting, not just the new `clans` blocks.

## UI

New 6th `.hub-section` in the Hub panel's existing "Zombie Survival"
tab (`#hub-page-survival`, following the exact same `.hub-section`/
`.hub-section-title` markup as the 5 existing sections: Player,
Difficulty, Choose Class, Game Modes, Challenges & Mutators), placed
right after the "Player" section since it's the next-most
identity-related one.

**Not in a clan:**
- A name input + "Create Clan" button, and a separate name search +
  "Join" button (reusing the existing leaderboard-by-name lookup
  pattern the Friend Compare box already uses).
- Requires being signed in via Cloud Save (same login gate every other
  online feature in this panel already uses) - shows the existing
  sign-in prompt otherwise, not a new one.

**In a clan:**
- Clan name + tag, member list (nickname + joined date, from the
  members subcollection), a leader badge next to whoever's the leader.
- Combined stats card: total members, summed best-kills and summed
  best-night across all members (computed by querying `leaderboard`
  where `clanId == this clan's id`, summing client-side - no new
  aggregate field to maintain).
- "Leave Clan" button (or "Disband Clan" if you're the leader and it's
  your last member, deleting the `clans/{clanId}` doc itself - if
  there are other members, the leader leaving just needs a next-leader
  handoff, which this v1 keeps simple by disallowing: **the leader
  must kick everyone else out (or transfer leadership isn't supported
  in v1) before they can leave** - the UI just disables "Leave" for a
  leader with other members present, with a short explanation. This is
  a deliberate v1 simplification, not an oversight - leadership
  transfer is real added scope (deciding a successor, handling a leader
  who never returns) that this spec explicitly doesn't take on.
- A leader-only "Kick" button next to each other member.

**Leave/kick and `leaderboard.clanId` staleness**: leaving or being
kicked deletes the member's `clans/{clanId}/members/{uid}` doc, but
does NOT also clear that player's `leaderboard.clanId` field in the
same operation (a client only has permission to write its OWN
leaderboard doc, per the existing rule - a kicked player's client
isn't necessarily even open/online at kick time to do this itself).
This means a kicked/left player can transiently still show up in the
old clan's combined-stats sum and still display the old clan's tag
until their OWN client writes their leaderboard doc again, which
already happens automatically after their next completed run (the
existing `_recordRunEnd`-style save path). This is an accepted,
self-healing staleness window (same trust posture as everything else
in this spec), not a bug to engineer around - each player's own client
clearing/setting `clanId` correctly whenever ITS OWN membership
changes (join, leave, or on Hub-panel open finding no matching
membership doc) is sufficient.

**Clan tag display**: shown next to the player's own name in the
existing places a nickname/tag already renders in this game
(`#menu-player-tag`-adjacent rendering, the leaderboard rows) - `[TAG]
Nickname`, reusing whatever the existing nickname-rendering call sites
already are rather than duplicating that logic. Only shown for players
who currently have a `clanId` set on their leaderboard doc.

## Testing

Playwright, in the same style as every other Cloud-Save-adjacent
feature tonight: since these tests need a real signed-in Firebase user
and a live Firestore instance, verify what CAN be verified without
that - the Hub section's UI states (not-signed-in prompt, no-clan
create/join form, in-clan member list/stats layout) render correctly
given mocked/injected data shapes, and that the create/join/leave/kick
button handlers call the right `CloudSync` functions with the right
arguments (a wiring-level check, same spirit as the touch-controls
verification approach) - not a live end-to-end Firestore round-trip,
which would need a real second test account and is out of scope for
an automated pass.
