# GayZ Multiplayer — Design

## Goal

Let a player invite friends (via a shareable link, opened from the pause menu) into a real shared game: no fixed player cap, seeing the same zombies, loot, and map state, fighting together. Individual coins/points/XP still accrue per player, same as a solo run.

**On "no limit":** the lobby itself (Phase 1) genuinely has no cap anywhere in the code - any number of people can join a session and show up in the player list. Once shared *gameplay* is built (Phase 3+), there's a real practical ceiling worth being upfront about: the host's own browser has to simulate every zombie for the whole group, and Realtime Database's bandwidth scales with player count × update rate. A handful of friends will run great; dozens of simultaneous players in one world would likely need the host to visibly struggle before anyone hits a hard-coded wall. Revisit with a real number once Phase 3 is actually running and its performance is measured, rather than guessing one now.

This is the first real-time multiplayer feature this project has ever had. Everything else online so far (Cloud Save, leaderboards, Friend List, community poll) is turn-based/eventual — a document write here, a read there, no strict timing requirement. This is different: player positions and zombie state need to update many times a second and stay close enough to in-sync that combat feels fair.

## Chosen approach: host-authoritative, over Firebase Realtime Database

One player (whoever creates the session) is the **host**. Their browser runs the real simulation — zombie spawns, AI, health, loot state — exactly like a solo run does today. The host streams that state to Firebase Realtime Database (RTDB) several times a second. Every other player's browser is a **viewer**: it renders whatever the host publishes, and sends its own player input (position, aim, shots fired) back through RTDB for the host to apply.

**Why RTDB, not Firestore.** This project already uses Firestore for Cloud Save, leaderboards, and friends — but Firestore is priced and designed around discrete document writes, not a fast stream of small updates. RTDB is Firebase's other product, built specifically for exactly this (a single JSON tree that pushes incremental updates to every listener with low latency). Same Firebase project, same billing account, no new service to create.

**Why host-authoritative, not fully peer-to-peer.** With multiple players, letting every client run its own independent zombie AI and trying to reconcile several diverging simulations is a much harder synchronization problem than one client being the single source of truth that everyone else mirrors. It also closes the obvious cheating angle (a viewer client cannot just decide a zombie died) for individually-tracked rewards to mean anything.

**Why not a dedicated game server (Colyseus/Photon/custom Node).** That is the "textbook correct" architecture for this kind of game, and worth reconsidering if this outgrows RTDB's limits later. But it requires standing up and paying for an always-on server process — a fundamentally new piece of infrastructure this project has never needed, on top of the free static hosting (Vercel) and serverless Firebase products it uses today. Not worth that jump for a first version.

**Why not WebRTC peer-to-peer.** No ongoing relay cost, but direct connections between two home networks fail more often than expected (firewalls, some routers, VPNs), and debugging a failed P2P handshake is a genuinely hard, often unfixable-from-our-side problem. RTDB "just works" the same way every other online feature in this game already does.

**Known limitation, accepted for v1:** if the host's tab closes or loses connection, the shared session ends for everyone. Host migration (promoting another player to host mid-session) is real added complexity — explicitly deferred to a later phase (see Phase 6), not blocking the first working version.

## Data model (Realtime Database)

```
/multiplayerSessions/{sessionId}/
  host: uid
  createdAt: timestamp
  status: "lobby" | "active" | "ended"
  players/
    {uid}/
      nickname
      joinedAt
      connected: bool        (RTDB onDisconnect() flips this false automatically)
  world/                      (host writes, viewers read-only)
    zombies/{zombieId}: { x, z, rotY, health, state, type }
    loot/{lootId}: { x, z, type, claimedBy }
    dayNight: { phase, startedAt }
  playerState/{uid}/          (that player writes their own, host reads all)
    x, z, rotY, health, currentWeapon, isFiring
```

A session is identified by a short `sessionId` (reuse the existing player-ID generator already used for friend codes — same shape, same collision-avoidance, no new ID scheme to invent). The invite link is just `gayz.vercel.app/?join=<sessionId>`.

**Security rules** (mirrors this project's existing pattern of "public read where needed, narrowly-scoped write"): any signed-in user can read a session they're a member of; only the host's uid can write to `world/*`; a player can only write to their own `playerState/{uid}` node. Session doc itself is only writable by whoever created it (sets `host` once, immutable after).

## Rewards & integrity

Kills/loot are attributed to whichever player's `playerState` the host's hit-detection resolves against — the host is already the authority on "did this shot land," so crediting the right player falls out of that naturally rather than needing a separate check. A lightweight abuse guard (e.g., a minimum-time-in-session before rewards bank, matching the spirit of existing anti-farming patterns in this codebase) is scoped into Phase 5, not the initial connection-and-see-each-other work.

## Phased build plan

1. **Invite link + lobby** — generate/join a session, a waiting-room screen showing connected players, host starts when ready. No shared gameplay yet.
2. **See each other** — player position/rotation/animation streamed and rendered for everyone once a run starts. Zombies still independent per client at this stage — proves the connection layer before the hard part.
3. **Shared zombies** — host becomes the sole zombie simulation; viewers render from the stream; a viewer's shot is sent to the host to resolve, not applied locally.
4. **Shared loot/doors/interactables** — host-arbitrated so two players can't double-claim the same pickup.
5. **Reward integrity** — confirm per-player coin/point/XP crediting is correct under real shared play, add the abuse guard above.
6. **Scale past 2 players + host-leaves handling** — test and tune real group sizes (see the Goal section's "On 'no limit'" note for why this isn't a fixed number), and decide/implement what happens when the host disconnects mid-session (end gracefully vs. migrate host).

Each phase ships as its own tested, working state before the next starts — matching how every other batch of work on this project has been built and verified this session, just at a much larger scale per phase.

## Testing approach

No test suite exists for this project (see its own CLAUDE.md) — verification is by driving the real running game. Multiplayer specifically needs **two simultaneous browser contexts** (two Playwright pages, or one Playwright page + a real manual browser) talking to the same RTDB session, checking that state written by one is observed by the other within a reasonable delay. This is a new verification shape for this project and should be established cleanly in Phase 1 rather than improvised per-phase.

## Open risks

- **RTDB free-tier bandwidth**: fine for a hobby project's real usage; revisit if this ever sees heavy concurrent use.
- **Clock/interpolation**: raw position snapshots streamed a few times a second will look choppy without basic interpolation on the receiving end (smoothing between the last two known positions) — small but real client-side work, called out here so it isn't missed.
- **Cheating ceiling**: host-authoritative closes off world-state cheating (can't fake a zombie kill), but a host could still cheat for themselves since they run their own simulation. Accepted for a friends-only hobby game; would need a real dedicated server to fully close.
