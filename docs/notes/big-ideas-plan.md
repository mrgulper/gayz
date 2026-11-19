# Big ideas plan (2026-11-19)

Gaymi picked 3 big ideas, in this order, in small batches (one batch per session).

## Nemesis Zombie (Gaymi: any zombie can become it)
- [x] Batch 1: the zombie that kills you becomes your Nemesis (localStorage `gayz-nemesis`), comes back once a run from wave 2 with a red tag, levels 1-5, beat it for coins. `NemesisZombie.js`, test in `zombies.spec.js`.
- [x] Batch 2: looks + memory - wider body (not taller: 2-block rule) + one red scar per level, a taunt speech bubble when it arrives, a Nemesis card at the top of the Zombie Book (Gaymi's pick), Cloud Save carries `gayz-nemesis` + new `gayz-nemesis-log` (beaten count, adds across devices), a red edge-of-screen arrow (Gaymi's pick). Gaymi doesn't hand-test.

## Clip Maker (Gaymi: let players pick the clip type)
- [ ] Batch 1: keep the last ~30 s of the game canvas (MediaRecorder), a Save Clip key/button + pause-menu button, saves a video file.
- [ ] Batch 2: options - Video or GIF, length (10/20/30 s), with or without sound, Custom (rule: always a Custom option).
- [ ] Batch 3: slow-mo and camera angles (replay-style), phone support check.

## Firebase check, then World Goal (Gaymi: reward changes each week)
- [ ] Batch 1: check everything Firebase (rules file vs code, every collection read/written, read-limit risks, sign-in, Cloud Save, Gallery/Postcards, chat, clans, market). Report + fix what's broken. Rules changes need Gaymi to paste them (hard to undo - ask first).
- [ ] Batch 2: World Goal counter - cheap design (each player adds in batches, one shared doc per week, few reads), rules for it.
- [ ] Batch 3: World Goal homepage bar + weekly rotating reward (cosmetic or loot), Terms/Privacy line.
