# Rules: shipping, CI, tests

Split out of the old `rules-detail.md` on 2026-11-13 (word for word, oldest first). Add new notes at the end.

- Every completed update gets committed, pushed to GitHub (`mrgulper/gayz`, private), and deployed to Vercel production (`npx vercel --prod --yes` → `gayz.vercel.app`) without asking each time.

- **Panel URLs need no per-route setup (2026-10-01).** `vercel.json` has ONE catch-all rewrite (`/((?!api/).*)` -> `/index.html`; Vercel serves real files first, so assets are unaffected). It used to list every panel path by hand (`/store`, `/inventory`...), and every new panel added to `_bindPanelRouting` without a matching line 404'd on refresh (reported on `/market`). Don't go back to a per-route list.

- For batched/greenlit feature work, build straight through without stopping for confirmation checkpoints between items.

- **Finish every update fully in one go - no background tasks (standing rule, 2026-10-10, Gaymi: "next time can you just fully finish instead of this 1 running task thing ... dont make 1 running task just fully finish it").** Run the test suite and every other long step in the foreground (a Bash call with a long `timeout`, e.g. `CI=1 npx playwright test` with `timeout: 600000`), never `run_in_background` or a Monitor, and don't end the turn until the work is tested, merged and pushed. If a step outlasts one call's timeout, keep calling in the foreground until it's done.

- **REMINDER FOR GAYMI ON/AFTER NOV 1, 2026: turn the "main needs green CI" ruleset back on** (GitHub repo > Settings > Rules > Rulesets > "main needs green CI" > Enforcement status: Active > Save). It was switched off 2026-10-05 because the free GitHub Actions minutes ran out (they reset Nov 1). Any session running on or after Nov 1 should tell the owner this first thing until they confirm it's done, then delete this line.

- **Merge only after CI is green (standing rule, 2026-10-04).** Open the PR, wait for the `build-and-test` check (lint, build, the docs check, the Playwright suite) to pass on its head, and only then merge - CI that runs after the merge can only report a broken `main`, not stop it. GitHub enforces it too since 2026-10-04: the repo ruleset "main needs green CI" (Settings → Rules → Rulesets, added by Gaymi - Claude sessions' GitHub access can't edit rulesets, 403) requires `build-and-test` to pass, and blocks deleting or force-pushing `main`. A PR can't merge while its check is red or still running, and nothing can be pushed straight to `main`.

- **Targeted tests, fewer screenshots, one PR per batch (standing rule, 2026-10-17, Gaymi: "Only run the tests that matter for small changes ... Fewer screenshots for small changes ... Send related requests together").** Asked to cut how long test -> fix -> merge takes and how much usage it costs. Small, one-area changes run lint + build + only that area's spec(s) (the map is in CLAUDE.md's "Which tests to run"); the full ~12 min suite is for big/shared-code changes and risky merges, and once the "main needs green CI" ruleset is back on (after Nov 1) CI runs the full suite on every PR. Both-theme screenshots only when something visible changed. Related requests are built as one batch: one build, one test run, one PR.
