# GayZ project notes

Browser Three.js block-world zombie game (Vite, no framework) at gayz.vercel.app. Owner: Gaymi (America/Los_Angeles). Verify by driving the real game with Playwright (`window.__game`, real methods in `page.evaluate()`).

**Kept short on purpose (read on every message).** One line per rule here; full wording and history in `docs/notes/` - read the file for an area before changing it, add new detail there, not here.

| Area | Notes file |
|---|---|
| Map 1 city, Map Editor (`Build*.js`), open world, Play, zombies, weapons, the 10 map-making rules | `map-and-world.md` |
| Homepage, panels, themes, Inventory/Market, skins, Gallery, Profile, Settings, i18n | `ui-and-menu.md` |
| Cloud Save, Firestore, leaderboards, chat, untrusted saves, offline | `online.md` |
| Bug patterns, performance, Playwright quirks | `bugs-and-testing.md` |
| Full text of every rule below (and this file's old long version) | `rules-detail.md` |
| Tests/CI, `Game.js` split, old plans | `codebase.md` |

## Tests and shipping
- Always `npm run lint` + `npm run build`. Tests: `CI=1 npx playwright test <spec>` (always `CI=1`, foreground, long timeout; full suite ~12 min).
- Small change = only its area's spec: menu/panels/themes/Inventory/Market `panels` · Settings/keys `settings` · skins `skindesigner` · Gallery `gallery` · servers/chat `servers` · saves `save` · stats/quests `progression` · Patch Notes/Features `docs` · Map 1/Editor/Play/world/weapons `buildmode` · offline `offline`. Full suite only for big changes to shared code (Game.js, BuildMode core, saves, build, service worker); a few-line edit in a shared file just runs the specs for the areas it touches (Gaymi, 2026-10-24).
- Ship: branch -> commit -> push `mrgulper/gayz` -> PR -> merge once green (merge title = PR title). One PR per batch. Vercel deploys `main`. Never `--no-verify`.
- **ON/AFTER NOV 1, 2026: tell Gaymi first thing to turn the "main needs green CI" ruleset back on** (repo Settings > Rules > Rulesets > Enforcement: Active). Off since 2026-10-05 (Actions minutes ran out). Delete this line once they confirm.

## Rules (one line each; full text in `rules-detail.md`)
- Public text (commit/PR titles go to public Discord): no owner name, no AI/Claude mentions. Don't undo the scrubbing in `discord-update-notify.yml`.
- `scripts/check-docs.mjs` (commit hook): player-facing changes update GayZ Features (`#features-main`, no hand-typed numbers) and Patch Notes, or say `[no-notes: why]` / `[no-features: why]`; changed `data-code` -> `[reread: <title>]`.
- Every Coming Soon spot has a GayZ Features Coming Soon entry (+ `tests/docs.spec.js` `MAP`).
- New online/player-data features also get a line in Terms of Use / Privacy Policy (index.html); their "Last updated" date fills itself from `__BUILD_DATE__`.
- New i18n keys ship in `en`, `zh`, `hi`, `es` together; player text names keys as `{key:<id>}`.
- Visible UI changes are made and screenshot-checked in both themes (Old: paper/browns/Rye; Clean: flat, one player-picked colour, `src/theme-clean.css`). Golden is deleted.
- Everything follows the theme: every panel, dropdown, pop-up, card and the Map Editor menu gets Old and Simple colours - never a fixed dark/gold box (Gaymi, 2026-10-24).
- Search bars: `class="nickname-input search-bar"`; text boxes and dropdowns are ovals.
- Panels: all the same height (`--panel-chrome`), no sideways scroll, join the shared selector list.
- Homepage: first paint = final look; footer clear of right column; animations on `LiteHome.onHomeFrame` only.
- Nameplate is one `.nameplate` filled by `Game._fillNameplate()`.
- Map-making rules (10, in `map-and-world.md`); changing the generator = bump `MAP3_EDITS_KEY` (BuildMode.js).
- Every standing mob is 2 blocks tall (`MOB_HEIGHT`).
- The underground is implicit (`Underground.js`) - never fill it in bulk.
- Every new full block gets a slab, stairs and a `BlockTextures.js` painter.
- New GLBs go through gltf-transform; credits in `public/models/weapons/CREDITS.txt` only.
- `vercel.json` keeps one catch-all rewrite.
- Split `Game.js`/`style.css` bit by bit: move an area into its own module (`scripts/move-to-module.py`) as a pure move commit before changing it. Never a big split.
- Don't ship inert UI.
- Single player works offline: no CDN loads; online-only buttons go in `ONLINE_ONLY`.
- Old Map 1 is gone for good - build on `BuildSurvival`/`BuildCamp`.

## Common traps (details in `bugs-and-testing.md`)
- Clone materials per instance before recolouring; never add/remove/toggle a `THREE.Light` at runtime.
- Nothing per-frame writes `localStorage`; persisted values are untrusted in `innerHTML` (`_escapeHtml`).
- `game.gameStarted` is never true - use `_showHomepageToast`. Cloud Save syncs are upload-only.
- Open-world terrain holds full cubes only.
- Playwright: poll for `window.__game`; timing checks in one `evaluate()`; `pkill -f chromium` alone.
