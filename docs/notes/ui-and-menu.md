# Homepage, menu, panels, inventory, skins and other UI - index

Split into topic files on 2026-11-13. Open only the one you need; add new notes at the end of the matching file (make a new file if none fits, and list it here).

| File | What's in it |
|---|---|
| [homepage-features.md](ui-and-menu/homepage-features.md) | Homepage shortcuts, Patch Notes/What's New, homepage character, rain, phone stacking, footer links, 17-feature batch, daily challenge card, funny update UI, reload size jump |
| [homepage-loading.md](ui-and-menu/homepage-loading.md) | First paint = final look, homepage pictures in the stylesheet, "problem loading" safety net, lighter homepage on touch, one homepage clock |
| [homepage-layout-history.md](ui-and-menu/homepage-layout-history.md) | Old redesign lessons: z-index layers, hero photo, cards row, off-center bugs, Play button centering, AAA/stencil passes, "make everything bigger" |
| [themes-and-panel-look.md](ui-and-menu/themes-and-panel-look.md) | Old theme (torn paper, metal plate, crates), equal-height panels, no sideways scroll, Golden deleted / Simple (Clean) added, biome look in games |
| [panels-profile-shop.md](ui-and-menu/panels-profile-shop.md) | Friends, Quests, Inventory, Global, nameplate/levels, Game Mode, Profile + sign-in card, upgrades, saved vs per-run state, World Map tabs, Friendship, shop colours, hover cards, Shop Inspect, achievement badges |
| [skins-and-design-a-skin.md](ui-and-menu/skins-and-design-a-skin.md) | `INVENTORY_SKINS`, Skin Designer, HD skins, Gallery, Design a Skin words / Smart Edit / Generate |
| [settings-and-translations.md](ui-and-menu/settings-and-translations.md) | Controls cleanup, Settings cleanups, settings reaching Map 1, reset warnings, right-click, graphics levels, Skin Lock, i18n rules (`tHtml`, `_updateTexts`) |
| [settings-ideas-todo.md](ui-and-menu/settings-ideas-todo.md) | "Settings ideas (to do)" list (read by `HudSettings.js`, `MoreSettingsList.js`, `GraphicsSettings.js`) |

Tip: many notes are dated batches that touch several topics; they sit in the file of their main topic. If a search here misses, `grep -rn "<word>" docs/notes/ui-and-menu/`.
