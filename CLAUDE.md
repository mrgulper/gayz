# GayZ project notes

Browser Three.js block-world zombie game (Vite, no framework) at gayz.vercel.app. Owner: Gaymi (America/Los_Angeles). Verify by driving the real game with Playwright (`window.__game`, real methods in `page.evaluate()`).

**Read on every message - keep it short.** Full wording and history live in `docs/notes/`; read an area's file before changing it, add detail there.

Notes files (big ones are indexes - open the index, then only the topic file you need): `map-and-world.md` -> `map-and-world/*.md` (Map 1, Map Editor, world, Play, zombies, weapons) · `ui-and-menu.md` -> `ui-and-menu/*.md` (homepage, panels, themes, Inventory/Market, skins, Profile, Settings, i18n) · `online.md` -> `online/*.md` (Cloud Save, Firestore, leaderboards, chat, offline) · `bugs-and-testing.md` · `rules-detail.md` -> `rules/*.md` (full rule text) · `codebase.md` (tests/CI, file splits).

## Tests and shipping
- Always `npm run lint` + `npm run build`. Tests: `CI=1 npx playwright test <spec> --reporter=dot 2>&1 | tail -60` (always `CI=1`, foreground, long timeout; dot + tail so only the totals and failures come back - saves usage).
- Small change = only its area's spec: menu/panels/themes/Inventory/Market `panels` · Settings/keys `settings` · skins `skindesigner` · Gallery `gallery` · servers/chat `servers` · saves `save` · stats/quests `progression` · Patch Notes `docs` · Map Editor/building `editor` · Map 1 play/guns/controls/pause/Spectate/phone `play` · open world/biomes/sky/weather `world` · In Real Life blocks `real-life-blocks` · zombies/creatures/events `zombies` · camp/crafting/vehicles/zone `camp` · party modes `party-modes` · Deathmatch `deathmatch` · spin ring `spin-ring` (these 9 were one `buildmode.spec.js` until 2026-11-16; an older note that says `buildmode` means one of them - grep the test title) · offline `offline` · catching/Team/battles `team`. Never the full suite locally (owner, 2026-11-22): GitHub CI runs all of it on every PR. Big shared-code changes (Game.js, BuildMode core, saves, build, service worker) run every touched area's spec, then wait for green CI before merging. The full local run is once a month, only when the owner asks.
- Ship: branch -> commit -> push `mrgulper/gayz` -> PR -> merge once green (merge title = PR title). One PR per batch. Vercel deploys `main`. Never `--no-verify`.
- The "main needs green CI" ruleset stays OFF until just before the CrazyGames launch (Gaymi, 2026-11-01): fix the flaky CI tests first, then remind them to turn it on (Settings > Rules > Rulesets > Enforcement: Active). Repo is public, so Actions minutes are free.

## Rules (one line each; full text in `rules-detail.md`)
- Public text (commit/PR titles go to public Discord): no owner name, no AI/Claude mentions. Don't undo the scrubbing in `discord-update-notify.yml`.
- `scripts/check-docs.mjs` (commit hook): player-facing changes update Patch Notes, or say `[no-notes: why]`; changed `code: '...'` links -> `[reread: <key>]`.
- GayZ Features left the game (2026-11-15): no page, no checks here. The owner's private full list is updated outside this repo.
- New online/player-data features also get a line in Terms of Use / Privacy Policy (index.html); their "Last updated" date fills itself from `__BUILD_DATE__`.
- New i18n keys ship in `en`, `zh`, `hi`, `es` together; player text names keys as `{key:<id>}`.
- UI (details in `rules-detail.md` > "Moved from CLAUDE.md"): check both themes, everything themed (in-game: biome), oval search bars/inputs, equal-height panels, homepage first paint = final look, one `.nameplate`.
- World (same place): 10 map-making rules + bump `MAP3_EDITS_KEY` on generator changes, mobs 2 blocks tall, underground implicit, new blocks get slab/stairs/painter, GLBs via gltf-transform.
- `vercel.json` keeps one catch-all rewrite.
- Split `Game.js` bit by bit (`scripts/move-to-module.py`, pure-move commit first). Styles: `src/styles/*.css`; text: `src/game/i18n/<lang>.js` (map in `codebase.md`) - grep, read only what you need.
- Don't ship inert UI.
- Single player works offline: no CDN loads; online-only buttons go in `ONLINE_ONLY`.
- Old Map 1 is gone for good - build on `BuildSurvival`/`BuildCamp`.

## Common traps (details in `bugs-and-testing.md`)
- Clone materials per instance before recolouring; never add/remove/toggle a `THREE.Light` at runtime.
- Nothing per-frame writes `localStorage`; persisted values are untrusted in `innerHTML` (`_escapeHtml`).
- `game.gameStarted` is never true - use `_showHomepageToast`. Cloud Save syncs are upload-only.
- Open-world terrain holds full cubes only.
- Playwright: poll for `window.__game`; timing checks in one `evaluate()`; `pkill -f chromium` alone.
