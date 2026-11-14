# Cloud Save, Firestore, online features and chat - index

Split into topic files on 2026-11-13. Open only the one you need; add new notes at the end of the matching file (make a new file if none fits, and list it here).

| File | What's in it |
|---|---|
| [cloud-save-and-sign-in.md](online/cloud-save-and-sign-in.md) | `CloudSync.js` setup, sign-in popup gotcha, three-way merge, untrusted saved stats / Import Save, restore-on-sign-in, best wave, Cloud Save audit, sign-in providers, no `firebase-admin/auth` in `api/` |
| [leaderboards-and-online-features.md](online/leaderboards-and-online-features.md) | Leaderboard, weekly ranking, Global Rank, community poll, aggregate-query gotcha, XP/levels/monthly clan XP, rejected writes (`is int`), clan member counts, online heartbeat |
| [chat-offline-teams.md](online/chat-offline-teams.md) | Chat + moderation, playing offline, offline detection, ghost teams, gauntlet teams |
| [servers.md](online/servers.md) | Server play smoothing: `NetSmooth.js` (other players and mirrored zombies predicted between syncs) |
| [console-and-admin.md](online/console-and-admin.md) | Firestore free read limit + watching it, Console admin/Safety/Players/Live events batches, gift codes, Daily Challenge editor, play counts, feedback/polls/errors/alerts, helpers, owner drop-in, live map, Hall of Fame |

Tip: if a search here misses, `grep -rn "<word>" docs/notes/online/`.
