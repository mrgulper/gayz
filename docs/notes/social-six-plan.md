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
| 2 | Clan War + Share codes (ClanWar.js, ShareCodes.js, tests/clan-war.spec.js) | done |
| 3 | Profile Guestbook + Message in a Bottle (SocialNotes.js, `guestbook/{owner}/entries`, `bottles`, tests/social-notes.spec.js) | done |
| 4 | Rules file + paste walk-through | todo |

Read-cost guard: every list loads only on click, small `limit()`s, bottles a few per day.

Batch 1 notes: one inbox for gifts + challenges (one read when the Friends panel opens).
Doc id kind_sender_day = 1 gift + 1 challenge per friend per day. Gift is credited only after
its doc is deleted (no double open). Accepted challenges: localStorage `gayz-friend-challenges`
(Cloud Save carries it), paid in ProgressUI's 'end' handler. Guesses: 500-coin / 5-item cap,
150-coin challenge reward, 7 days, 5 at once. Coins are client-side, so a cheater could send
coins they don't have - capped by the rules at 500 per friend per day.

Batch 2 notes (Gaymi's answers): real player kill in Deathmatch / Team Deathmatch = 1 point;
zombies AND bots 0.01-0.99 by toughness (zombie: full health / 1000, so wave-1 = 0.10; bot: its
gun's damage per second x 0.02). Weekly + monthly races at once, weekly prizes smaller. Board =
the existing Clan panel > Clans list, now with Month XP / War: Week / War: Month buttons.
Points ride on the player's own leaderboard doc (cw* fields, hundredths) like clan XP, so the
board costs no extra reads; the doc also keeps last week/month so prizes still work after the
reset. Weeks = Monday, months = 1st, LA clock. Prizes (guesses): week 300/150/75, month
1500/750/400 coins for #1-3, only for members who scored for that clan that period, claimed once
(localStorage `gayz-clan-war-claimed`). The leaderboard rule has no hasOnly, so cw* fields
already save before the paste; Batch 4 adds their bounds. Easy custom-lobby rules lower zombie
points (rewardMult). Share codes: GZR1-<id.rarity_...> (ring, only owned items go in) and
GZL1-<base64> (lobby rules; name/password not included). No Firebase.

Batch 3 notes: Guestbook = every player's profile (signed in, not your own), loads only on Open
Guestbook (one query, limit 20, shows 10 not-reported). Your own = Profile panel > Guestbook tab,
delete any line. Id writer_day (UTC days, server clock) = one line a day per guestbook. Bottles =
Friends panel, 3 throws + 3 finds a day (guess). Throw id uid_day_n (n 1-3) so the rules hold the
throw cap; the find cap is local (`gayz-bottles`, also keeps the last 10 found). Find = one
`rnd >= random` query (limit 5), wraps to 0, skips own/reported/already seen. Report = anyone can
flip `reported` false -> true (Gaymi: reported = hidden, so 1 report hides). Normal swear filter
before send, Strict on show, 100 letters. Old bottles are never cleaned up (fine for now).
