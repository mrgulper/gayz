# Multiplayer Proxy (Ad-Blocker Fix) Design

## Goal

Multiplayer position-syncing (Phase 2, shipped earlier today) sometimes silently fails: two players can create a session, join it, and both play normally, but never see each other's character. Confirmed cause: at least one tester has an ad blocker / privacy extension enabled, and `firebaseio.com` (Firebase Realtime Database's domain) is commonly caught by ad/tracking blocklists even though nothing about this traffic is ad- or tracking-related.

This spec covers the real fix: route all multiplayer traffic through `gayz.vercel.app` itself (a server-side relay), so the browser never talks to any Firebase domain directly for multiplayer. Since ad blockers only intercept traffic the browser itself sends, server-to-server traffic between Vercel and Firebase is invisible to them regardless of blocklist contents - this fully closes the door, not just narrows it.

**Explicitly out of scope for this spec:** Cloud Save / leaderboards (a separate Firebase product, Firestore, not reported broken). Gaymi asked for this to get the same treatment eventually; it's deliberately deferred to its own follow-up spec so this one stays focused and shippable on its own.

## Chosen Approach

**Vercel Serverless Functions as a full relay, Firebase Realtime Database kept as the actual storage, polling instead of push updates, and a fully custom (non-Firebase) session identity.**

Each of these was an explicit decision point during design, not a default:

- **Keep Firebase as storage, vs. build a Vercel-native store, vs. build a Firebase clone.** Building "a whole Firebase" (auth system, security rules engine, global infra, admin console) was ruled out outright as wildly disproportionate for a hobby project. A Vercel-native store (e.g. Vercel KV) was considered and would work equally well for the ad-blocker problem (server-to-server traffic is invisible to ad blockers no matter which company runs the backend) - Gaymi chose to keep Firebase specifically to avoid migration work and keep using Firebase Console to inspect data, since there's no ad-blocker benefit either way.
- **Polling vs. real-time push (streaming/WebSocket).** A persistent push-style connection (matching today's Firebase `onValue` behavior) doesn't fit Vercel's serverless function model well (functions are short-lived, not designed to hold connections open) and would be meaningfully more complex to build and debug correctly. Polling every ~300ms is simpler, more robust, and the added latency (roughly a third of a second instead of near-instant) is imperceptible for this kind of casual gameplay.
- **Custom session tokens vs. keep Firebase Anonymous Auth.** Keeping Firebase Auth would mean the browser still makes one direct call to a Firebase domain before every session - a smaller remaining thread ad blockers could still catch, and blocklists do sometimes cover Firebase Auth's domains too. A session-scoped ID minted by our own `create`/`join` endpoints removes this entirely: the browser never touches any Firebase address at all for multiplayer, and multiplayer identity was already ephemeral/per-session (never tied to a Cloud Save account), so this is a natural fit, not scope creep.

## Architecture

```
Browser (Multiplayer.js)
   |
   |  fetch() to gayz.vercel.app/api/multiplayer/*
   v
Vercel Serverless Functions (new /api/multiplayer/*.js)
   |
   |  Firebase Admin SDK (server-to-server, never touches the browser)
   v
Firebase Realtime Database (same project, same data shape as today)
```

The browser's only network dependency for multiplayer becomes `gayz.vercel.app` - the same domain the game already loads from. Firebase Realtime Database's security rules get tightened to deny all direct client access (`.read: false, .write: false` everywhere), since only the server's Admin SDK will ever touch it going forward - a real security improvement over today's rules, which currently do allow direct client access (gated by Firebase Auth).

## API Contract

Four endpoints under `/api/multiplayer/`, mirroring today's `Multiplayer.js` function names so `Game.js` needs no changes to its call sites - only `Multiplayer.js`'s internals change from "talk to Firebase" to "talk to our own API":

- **`POST /api/multiplayer/create`** - body `{ nickname }` → `{ sessionId, playerId }`. Creates a session, generates a random `playerId` (this replaces Firebase Auth's uid), records the creator as a player.
- **`POST /api/multiplayer/join`** - body `{ sessionId, nickname }` → `{ playerId }`, or a clear error if the session doesn't exist. Generates a new `playerId` for this joiner and adds them to the session's player list.
- **`POST /api/multiplayer/sync`** - body `{ sessionId, playerId, x, y, z, rotY, currentWeapon, isFiring }` → `{ states: { [otherPlayerId]: { x, y, z, rotY, currentWeapon, isFiring, updatedAt } } }`. Writes this player's own state AND returns everyone else's current state in the same round trip - one HTTP call covers what today takes both `updatePlayerState` and `subscribeToPlayerStates`. Called on the same ~100ms throttle already used in `Game.js`'s `_tick()`, though the actual poll cadence for *reading* others' state can be slightly longer (~300ms) without being noticeable, to keep request volume reasonable.
- **`POST /api/multiplayer/leave`** - body `{ sessionId, playerId }`. Removes the player's entry and their position state in one call.

Every call after `create`/`join` includes the `playerId` the server handed out, functioning like a per-session room key: proportionate security for a casual friends game with nothing valuable at stake (no real money, no persistent progress tied to a session), matching the original multiplayer design doc's decision to defer full anti-cheat/integrity work to a later phase.

## Disconnect Handling

Polling can't detect a dropped connection the instant it happens the way Firebase's `onDisconnect()` hook does (that relies on a live, persistent connection the server can watch). Two mechanisms combine to keep this close to instant in practice:

1. **Graceful quit (the common case):** the client's "leave" call uses `navigator.sendBeacon()` instead of a normal `fetch()` - a browser feature specifically guaranteed to complete even as the page is closing or reloading. This is actually *more* reliable than today's Firebase-based cleanup, which sometimes loses the race against `window.location.reload()` (a known, already-documented issue in this codebase).
2. **Messy disconnect (crash, force-quit, dropped wifi):** the `sync` endpoint excludes any player whose last update is older than a short staleness window (2-3 seconds) when building its response. No separate cleanup process is needed for this - it's just a filter applied at read time. Actual row deletion for long-abandoned sessions can happen lazily (e.g. swept during a later `sync` call, or a low-frequency Vercel Cron job) since stale data sitting unread in the database costs nothing and is invisible to players either way.

Net effect: a normal quit is near-instant; the worst case (something crashes with no chance to clean up) is bounded at 2-3 seconds instead of open-ended.

## Security & Secrets

Firebase Admin SDK access requires a service account key - a real secret credential with elevated database privileges. This is stored as a Vercel environment variable, never committed to the repo and never shipped to the browser; only the serverless functions (running on Vercel's servers) read it at runtime. Setup is a one-time step: Firebase Console → generate a service account key → paste it into Vercel's dashboard as an environment variable - similar in spirit to the existing one-time Firebase Console setup steps this project has already walked through (enabling Anonymous Auth, pasting security rules).

## File Structure

- **New: `api/multiplayer/create.js`, `api/multiplayer/join.js`, `api/multiplayer/sync.js`, `api/multiplayer/leave.js`** - Vercel serverless functions, one per endpoint (Vercel's zero-config convention: each file under `/api` becomes a route).
- **New: `api/_lib/firebaseAdmin.js`** - shared Firebase Admin SDK initialization (reads the service account key from the environment variable, exposes a ready-to-use database handle to the four endpoint files).
- **Rewrite: `src/game/Multiplayer.js`** - same exported function names and shapes (`createSession`, `joinSession`, `updatePlayerState`+`subscribeToPlayerStates` merged into a single polling loop, `removePlayerState`/`leaveSession` merged into one `leave` call), but internals become `fetch()` calls to the new API instead of `firebase/database`/`firebase/auth` imports. `MULTIPLAYER_SECURITY_RULES`'s exported value changes to the fully-locked-down rules described above.
- **Modify: `src/game/Game.js`** - minimal changes expected. The subscription-based `_ensureMultiplayerPlayerStatesSubscription()` gets replaced by a polling throttle (same idiom already used for the write side), and since `sync` returns other players' states directly, `_syncNetworkPlayerState()` can call `_renderRemotePlayers()` itself with the response - collapsing two `_tick()` calls into one.

## Testing Approach

Same verification method this project has used throughout (no test framework - drive the real running game via Playwright, per this project's own CLAUDE.md). One workflow change: local testing of the new server functions needs `vercel dev` (Vercel's local emulator, which runs both the Vite dev server and the `/api` functions together) instead of plain `npm run dev`, since Vite alone doesn't execute serverless functions. Verification scripts will call the real `/api/multiplayer/*` endpoints (via the game's own methods, `window.__game.*`, same pattern already established this session) rather than importing Firebase directly, since that's now entirely server-side.

## Open Risks

- **Vercel free-tier function limits.** Hobby-scale usage (a handful of friends playing at once) is comfortably within Vercel's free tier request/execution limits; this isn't expected to be a real constraint unless the game sees far more concurrent multiplayer usage than currently anticipated.
- **Slightly higher latency for seeing others move** (polling ~300ms vs. today's near-instant push) - already accepted as a worthwhile trade for simplicity and full ad-blocker resilience.
- **Cloud Save/Firestore is not covered by this spec** - if it turns out ad blockers cause similar issues there, that's a separate follow-up spec, not silently bundled into this work.
