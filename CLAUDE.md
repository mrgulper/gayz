# GayZ project notes

Browser Three.js block-world zombie game (Vite, no framework) at gayz.vercel.app. Owner: Gaymi (America/Los_Angeles). Verify by driving the real game with Playwright (`window.__game`, real methods in `page.evaluate()`).

**Read on every message - keep it short.** Full wording and history live in `docs/notes/`; read an area's file before changing it, add detail there.

Notes files: `map-and-world.md` (Map 1, Map Editor, world, Play, zombies, weapons) · `ui-and-menu.md` (homepage, panels, themes, Inventory/Market, skins, Profile, Settings, i18n) · `online.md` (Cloud Save, Firestore, leaderboards, chat, offline) · `bugs-and-testing.md` · `rules-detail.md` (full rule text) · `codebase.md` (tests/CI, file splits).

## Tests and shipping
- Always `npm run lint` + `npm run build`. Tests: `CI=1 npx playwright test <spec>` (always `CI=1`, foreground, long timeout; full suite ~12 min).
- Small change = only its area's spec: menu/panels/themes/Inventory/Market `panels` · Settings/keys `settings` · skins `skindesigner` · Gallery `gallery` · servers/chat `servers` · saves `save` · stats/quests `progression` · Patch Notes/Features `docs` · Map 1/Editor/Play/world/weapons `buildmode` · offline `offline`. Full suite only for big shared-code changes (Game.js, BuildMode core, saves, build, service worker).
- Ship: branch -> commit -> push `mrgulper/gayz` -> PR -> merge once green (merge title = PR title). One PR per batch. Vercel deploys `main`. Never `--no-verify`.
- **ON/AFTER NOV 1, 2026: tell Gaymi first thing to turn the "main needs green CI" ruleset back on** (repo Settings > Rules > Rulesets > Enforcement: Active). Off since 2026-10-05 (Actions minutes ran out). Delete this line once they confirm.

## Rules (one line each; full text in `rules-detail.md`)
- Public text (commit/PR titles go to public Discord): no owner name, no AI/Claude mentions. Don't undo the scrubbing in `discord-update-notify.yml`.
- `scripts/check-docs.mjs` (commit hook): player-facing changes update GayZ Features (`#features-main`, no hand-typed numbers) and Patch Notes, or say `[no-notes: why]` / `[no-features: why]`; changed `data-code` -> `[reread: <title>]`.
- Every Coming Soon spot has a GayZ Features Coming Soon entry (+ `tests/docs.spec.js` `MAP`).
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
