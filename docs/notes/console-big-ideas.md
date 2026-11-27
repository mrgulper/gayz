# Console big ideas (2026-11-27)

Gaymi picked 6 bigger Console ideas (skipped #4 "Test Two Versions").
One batch per session, in this order (data ones first: their counts start
the day each one ships). Each batch: game side (if any) + Console side +
Features page + Privacy Policy when new data is collected.

| # | Batch | What it is | Status |
|---|-------|------------|--------|
| 1 | Death Heatmap | Charts tab: city map seen from above, red where players die (8x8-block squares). Game counts stat `death` (cell key or `out`). | Done (this PR) |
| 2 | Quit Funnel | Charts tab: how many new players reach each step (homepage → first game → first zombie kill → first death → wave 3 → second game → next day). Game counts each step once per device. | Next |
| 3 | Coin Flow | Charts tab: where coins come from (chests, quests, waves, selling...) and where they go (shop, pet shop, upgrades...). Daily totals by source/sink. Shows which guessed prices are off. | |
| 4 | Player Story | Player card: one timeline of everything about a player (first seen, reports, warnings, gifts, chat, notes, ID changes, leaderboard). Reads what the Console already stores. | |
| 5 | Event Planner | New tab: a calendar. Plan things ahead and they switch on/off by themselves: Events, Banner + message of the day, Switches + Themes, Giveaways. Runs from the 10-minute site-check poke. | |
| 6 | Watch List | Flag a player; get a Discord ping (private alerts channel) + a Console list when they come online, top a leaderboard, or get reported again. | |

Rules for every batch: add new game admin actions to the Console's
`api/admin.js` ACTIONS too; console deploys with `npx vercel --prod`;
everything anonymous stays anonymous (no Player ID in stats).
