# Playing on servers (PlayNet)

- **NetSmooth.js (2026-11-13):** other players (`PlayNet._drawPlayer`) and a guest's mirrored zombies (`_updateMirroredZombies`) get their target from `setTarget` (speed from the last two syncs) and `ahead(o, dt)` carries it on for up to `AHEAD_S` 0.25 s between syncs, so they glide instead of trailing and lurching. Speeds over `MAX_SPEED` (teleports) aren't guessed. Sync rate unchanged.
