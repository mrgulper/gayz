# Playing on servers (PlayNet)

- **NetSmooth.js (2026-11-13):** other players (`PlayNet._drawPlayer`) and a guest's mirrored zombies (`_updateMirroredZombies`) get their target from `setTarget` (speed from the last two syncs) and `ahead(o, dt)` carries it on for up to `AHEAD_S` 0.25 s between syncs, so they glide instead of trailing and lurching. Speeds over `MAX_SPEED` (teleports) aren't guessed. Sync rate unchanged.

## Custom lobbies + rings on servers (2026-11-15, spin ring Batch 4)
- Global > Custom tab (was Coming Soon): lists only `custom` servers (other tabs skip them). Its Create button opens `#custom-lobby-form` (CustomLobbyUI.js) in place of the list; every number picker has a Custom typed value.
- Rules: `src/game/LobbyRules.js` (plain data; the API imports `cleanLobbyRules` too). `{ ring, ff, max 2-8, zh, zc, boss, hp, dmg, spd }`. Stored on `servers/{id}.rules`; create/join return `{ custom, rules }`. `BuildSurvival._applyLobbyRules` resets cfg to PLAY_DEFAULTS + rules (the joiner's own Game Mode settings don't count).
- Easy rules earn less: `rewardMult(rules)` (1 for normal/harder, min 0.1) -> `cfg.coinMult`, Legacy Points (`data.rewardMult` in ProgressUI), RingLoot.dropFrom chance.
- Password: only `passHash` (sha256 of `id:password`) is stored, never listed/returned; join error `password`. PlayNet keeps the typed password for `_rejoin`.
- Rings: each player's sync sends `ring: { k, r }` (SpinRing.netState); RemoteRings.js draws it round their avatar. Friendly fire (`rules.ff`): SpinRing._touchPlayers -> PlayNet.queuePvp -> `body.pvp` -> target's `hurt` queue (server ignores it unless the lobby has ff). The safe camp still blocks all hurt.
- Guest kill drops: kill credits carry `at: [x,y,z]`; the killer's own RingLoot drops there (host doesn't drop for guest kills).
- Specs: "servers: custom lobbies - ..." (API) and "custom lobby: the host sets the rules ..." (two pages). "the owner drops into a game" is flaky on main too (horde count 0 ~1 in 4).
