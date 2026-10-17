# GayZ project notes

Browser Three.js block-world zombie-survival game (Vite, no framework), deployed at gayz.vercel.app. Owner: Gaymi (Cupertino, America/Los_Angeles). Verify changes by driving the real running game with Playwright (`page.evaluate()` on real game methods via `window.__game`), plus the committed suite.

**This file is kept short on purpose** (it is read on every message). The detailed history and how-it-works notes live in `docs/notes/` - read the file for the area you're touching before changing it, and add new detailed notes there (end of the matching file), with only a one-line pointer or rule here if it must always be followed.

| Read before touching... | File |
|---|---|
| Map 1 block city (`Map3Generator.js`, `CityShape.js`), Map Editor (`BuildMode.js` + `Build*.js`), open world (`OpenWorld.js`, `WorldStructures.js`), Play/zombies/skeletons, servers, weapons, aiming | `docs/notes/map-and-world.md` |
| Homepage/menu layout, panels, themes, Inventory/Market/Inspect, Design a Skin, Gallery, Profile/Friends, Settings, i18n | `docs/notes/ui-and-menu.md` |
| Cloud Save, Firestore rules, leaderboards, chat, untrusted save data, playing offline (service worker) | `docs/notes/online.md` |
| Known bug patterns, performance gotchas, Playwright quirks | `docs/notes/bugs-and-testing.md` |
| Full wording + history of every standing rule below, incl. the 10 map-making rules | `docs/notes/rules-detail.md` |
| Tests/CI details, the `Game.js` split convention, `3D_ASSET_OVERHAUL.md`, `docs/PERFORMANCE.md` | `docs/notes/codebase.md` |

Code comments that say "see CLAUDE.md's ... note" now mean these notes files - grep `docs/notes/` for the name.

## Tests, build, deploy

- `npm run lint`, `npm run build`, `CI=1 npx playwright test` (always with `CI=1`; the full suite takes ~12 min - run it in parts by spec file if one call would time out). Tests are in `tests/*.spec.js`; feature work also needs its own targeted Playwright check.
- **Which tests to run (2026-10-17, Gaymi, to save time and usage):** lint + build always. **Small changes** (one area, e.g. a menu tweak, a text fix, one panel) run only the spec(s) for that area: menu/panels/themes/nameplate/Inventory/Market -> `panels.spec.js`; Settings/keys -> `settings.spec.js`; Design a Skin -> `skindesigner.spec.js`; Gallery -> `gallery.spec.js`; servers/chat -> `servers.spec.js`; saves/Cloud Save -> `save.spec.js`; stats/achievements/quests/upgrades -> `progression.spec.js`; Patch Notes/GayZ Features -> `docs.spec.js`; Map 1/Map Editor/Play/open world/weapons -> `buildmode.spec.js` (or `-g` the matching tests); offline/service worker -> `offline.spec.js`. **The full suite** runs for big changes (several areas, shared code like Game.js/BuildMode.js core, saves, the build or service worker) and before risky merges. Once CI is back on (after Nov 1, below) it runs the full suite on every PR, so locally only the targeted specs are needed.
- `scripts/check-docs.mjs` runs as the commit-msg hook and in CI (see the Patch Notes / GayZ Features rules below). Never `--no-verify`.
- Vercel deploys `main` automatically on merge (no login needed).
- **REMINDER FOR GAYMI ON/AFTER NOV 1, 2026: turn the "main needs green CI" ruleset back on** (GitHub repo > Settings > Rules > Rulesets > "main needs green CI" > Enforcement status: Active > Save). It was switched off 2026-10-05 because the free GitHub Actions minutes ran out (they reset Nov 1). Any session running on or after Nov 1 should tell the owner this first thing until they confirm it's done, then delete this line. Until then, run lint + build + the tests above locally (all green) before merging.

## Standing rules (full text in `docs/notes/rules-detail.md`)

- **Ship every update fully:** commit, push to `mrgulper/gayz`, open a PR, merge only once lint/build/tests are green (CI or, while CI is off, locally - see "Which tests to run"), merge commit title = PR title. Build greenlit batches straight through without checkpoints, as **one** build, test run and PR per batch (related requests sent together are one PR, not several).
- **No background tasks.** Run long steps (the test suite) in the foreground with a long timeout; don't end the turn until it's tested and merged.
- **Public text never names the owner or AI tools.** PR and commit titles go to the public Discord `#updates` feed: plain player-facing descriptions, no username, no "Claude"/"AI". Don't undo the scrubbing in `.github/workflows/discord-update-notify.yml`.
- **Patch Notes (`#changelog-list` in `index.html`) and GayZ Features (`#features-main`) are updated in the same change as every player-facing update.** Patch Notes: newest `vX.YY · Mon D, YYYY` entry, dated by `TZ=America/Los_Angeles date` (or the date on Gaymi's screenshot clock); groups Added / Changed / Fixed, one short bullet per change. GayZ Features: new features get a `<div class="feature" data-code="...">`, changed ones get fixed; no hand-typed numbers (use `data-feature-value`/`data-feature-count` spans); when code linked by `data-code` changes, re-read the entry and name it with `[reread: <title>]` in the commit body. Skips need `[no-notes: why]` / `[no-features: why]` in the commit body.
- **Every Coming Soon spot in the game has a GayZ Features Coming Soon entry** (and a line in `tests/docs.spec.js`'s `MAP`).
- **Every new i18n key ships in `en`, `zh`, `hi` and `es` together.** Player text never types a key letter - use `{key:<id>}`.
- **Every UI change is made for both themes** (Old: paper, dark ink, browns, Rye; Golden: dark panels, gold) and checked with a screenshot in each - only when something visible changes; code-only changes need no screenshots.
- **Search bars** use `class="nickname-input search-bar"`; text boxes and dropdowns are ovals (`border-radius: 999px`).
- **Panels:** every panel and tab is the same height (`min-height: calc(68vh + var(--panel-chrome))`), nothing scrolls sideways, and new panels join the shared selector list in `style.css`.
- **Homepage:** its first paint is its final look (layout fitters in `index.html`'s inline `__menuLayout`, first-screen pictures in `src/menu-art/`); footer links stay clear of the right column; homepage animations run on `LiteHome.onHomeFrame` and never animate `background-position`, `filter` or a blended layer.
- **The nameplate** (level, name, clan) is the same `.nameplate` filled by `Game._fillNameplate()` on the homepage character and in Inventory.
- **Map-making** (`Map3Generator.js`, any generated map): only existing `BLOCK_TYPES`; nothing "squared" or on a street grid; uneven ring of edge buildings; no ruined buildings; liquids sealed; ladders against walls; sloped roofs only on whole rectangles at half a block per cell; every building enterable and climbable; check it automatically (walking flood fill, ladders, water) and by flying the camera. Changing the generator = bump `MAP3_EDITS_KEY`. Full 10 rules in `rules-detail.md`.
- **Every new full block gets a slab and stairs** (generated by the loops after `BLOCK_TYPES`) and its own painter in `BlockTextures.js`.
- **New GLBs** go through gltf-transform (small textures, meshopt) before committing; credit makers in Credits.
- **Panel URLs:** `vercel.json` has one catch-all rewrite - never a per-route list.
- **Split `Game.js` and `style.css` bit by bit (standing rule, 2026-10-16, Gaymi: "do it bit by bit").** Whenever an update works in an area of `Game.js` (Settings, Clans, Profile, Friends, Market, Upgrades...), first move that area into its own module the usual way (plain functions taking `game`, state stays on `game` - see `docs/notes/codebase.md`), as a pure move in its own commit before the feature change, checked with lint + build + the tests for that area. `python3 scripts/move-to-module.py NewModule.js "header comment" _method1 _method2 ...` does the move mechanically (one-line stand-ins stay in Game.js so callers are unchanged; imports/exports are wired up); `check-docs.mjs` recognises moved lines, so a pure move needs only `[no-notes: ...]`/`[no-features: ...]`, no `[reread: ...]`. Same for a large self-contained block of `style.css` (its own CSS file imported next to it). Never a big all-at-once split, never a move mixed into a behaviour change.
- **Don't ship inert UI.**
- **Everything single player works offline** (service worker `src/sw.js`, `Offline.js`): load files from the game itself, never a CDN; new online-only buttons go in `ONLINE_ONLY` (+ `offline.css`). Details in `docs/notes/online.md`.
- **Old Map 1 is gone for good** - new Map 1 features are built for the block-city engine (`BuildSurvival`/`BuildCamp`), never by bringing back old code.

## Most common traps (details in `docs/notes/bugs-and-testing.md`)

- Clone materials per instance before flashing/recolouring them.
- Never add, remove or toggle a `THREE.Light` at runtime - the block world has no point lights (glow is baked vertex light).
- Nothing in the per-frame path writes to `localStorage`.
- Treat every persisted value as untrusted in `innerHTML` (`_escapeHtml`, `_safeStatNumber`) - Import Save exists.
- `game.gameStarted` is never true now: use `_showHomepageToast`.
- Cloud Save is a three-way merge; automatic syncs are upload-only - never add an automatic apply/reload.
- Open-world terrain can only hold full cube blocks (no ladders, slabs, fences, doors).
- In Playwright: wait for `window.__game` with a poll loop; keep timing-sensitive checks in one `evaluate()`; `pkill -f chromium` in its own command, never chained with other commands.
