# Standing rules - index

Full rule text, split into topic files on 2026-11-13. Open only the one you need; add new rules at the end of the matching file.

| File | What's in it |
|---|---|
| [shipping-and-tests.md](rules/shipping-and-tests.md) | Commit/push/deploy every update, finish in one go, build straight through batches, panel URLs (one catch-all rewrite), merge after green CI, CI ruleset reminder, which tests to run |
| [player-text-and-pages.md](rules/player-text-and-pages.md) | No owner/AI names in public text, Patch Notes (always, local date, format), GayZ Features + Coming Soon, check-docs script, sentences tied to code, `{key:<id>}`, i18n in 4 languages |
| [look-and-blocks.md](rules/look-and-blocks.md) | Every theme, search bars, Map Editor picker, slab + stairs for every block, nameplate, don't ship inert UI |

Old full copy of CLAUDE.md (before the 2026-10-23 trim): [history/claude-md-before-2026-10-23.md](history/claude-md-before-2026-10-23.md) - history only.

### Moved from CLAUDE.md (2026-10-30, to save usage - still in force)

- Visible UI changes are made and screenshot-checked in both themes (Old: paper/browns/Rye; Clean: flat, one player-picked colour, `src/theme-clean.css`). Golden is deleted.
- Everything follows the theme: every panel, dropdown, pop-up, card and the Map Editor menu gets Old and Simple colours - never a fixed dark/gold box (Gaymi, 2026-10-24). In a running game screens follow the biome instead (`src/play-biome.css`, 2026-10-25; Settings toggle `playBiomeLook`, default on; readable opposite-colour text).
- Search bars: `class="nickname-input search-bar"`; text boxes and dropdowns are ovals.
- Panels: all the same height (`--panel-chrome`), no sideways scroll, join the shared selector list.
- Homepage: first paint = final look; footer clear of right column; animations on `LiteHome.onHomeFrame` only.
- Nameplate is one `.nameplate` filled by `Game._fillNameplate()`.
- Map-making rules (10, in `map-and-world/map1-and-map-rules.md`); changing the generator = bump `MAP3_EDITS_KEY` (BuildMode.js).
- Every standing mob is 2 blocks tall (`MOB_HEIGHT`).
- The underground is implicit (`Underground.js`) - never fill it in bulk.
- Every new full block gets a slab, stairs and a `BlockTextures.js` painter.
- New GLBs go through gltf-transform; credits in `public/models/weapons/CREDITS.txt` only.
