# Social six plan (2026-11-20)

Six new online features, built in batches, ONE Firestore rules paste at the very end
(Gaymi: "we do the firebase last when we finish all 6 features"). Each batch adds its
rules blocks to `FIRESTORE_SECURITY_RULES` in CloudSync.js; the last step writes
`~/Desktop/GayZ/firestore-rules-<date>-social.txt` (= live 11-20-builds file + all new blocks)
and walks Gaymi through the paste. Until then the new features fail quietly online.

Gaymi's answers:
- Gift Box: coins + items (to a friend). Daily cap.
- Clan War: ALL clans race on one weekly board (no 1v1). Deathmatch/PvP kill = 1 point,
  normal zombie kill = 0.1, tougher zombies (more health) = more points.
- Bottles + Guestbook: chat filter + 100-letter cap + report button (reported = hidden).
- Batches: as many as needed, keep usage low.

| Batch | Features | Status |
|---|---|---|
| 1 | Gift Box + Friend Challenges (FriendMail.js, `friendMail/{toUid}/inbox`, tests/friend-mail.spec.js) | done |
| 2 | Clan War + Share codes (spin-ring loadout, custom lobby rules) | todo |
| 3 | Profile Guestbook + Message in a Bottle | todo |
| 4 | Rules file + paste walk-through | todo |

Read-cost guard: every list loads only on click, small `limit()`s, bottles a few per day.

Batch 1 notes: one inbox for gifts + challenges (one read when the Friends panel opens).
Doc id kind_sender_day = 1 gift + 1 challenge per friend per day. Gift is credited only after
its doc is deleted (no double open). Accepted challenges: localStorage `gayz-friend-challenges`
(Cloud Save carries it), paid in ProgressUI's 'end' handler. Guesses: 500-coin / 5-item cap,
150-coin challenge reward, 7 days, 5 at once. Coins are client-side, so a cheater could send
coins they don't have - capped by the rules at 500 per friend per day.
