# Disposable SPN-010 experiment

This branch is evidence tooling, **never a production implementation or merge candidate**.
All authored runtime and test code is TypeScript; generated Vite JavaScript is ignored.
Use the unmodified public Univer APIs. No license key, patch, decompilation or watermark
suppression is part of this experiment.

From this folder with Node 24.19.0:

```sh
npm ci
npm run typecheck
npm run build
npm start
# In another terminal:
node matrix.ts
SPN_SOAK_MINUTES=1 node soak.ts  # pilot only; cannot produce acceptance
node soak.ts                   # 25-hour target; requires uninterrupted evidence
```

The server binds only 127.0.0.1:3110, creates 12 Sheets and 12 Docs in local SQLite,
and trusts synthetic `spike-user=user-N` cookies. It deliberately grants every action.
Never expose it, reuse real credentials, or put real documents in it.
Each independent Chromium context has a different identity; all edits use visible
name-box and keyboard/text-input actions. The exposed snapshot function is read-only.

Matrix: 2, 3, 4, 6 editors each with one Sheet and one Doc; then two editors across
six active units (three of each). Three serial rounds are followed by an overlapping
burst; peers must retain expected edits, converge, and retain content after reload.
Soak: two editors with one Sheet and one Doc; overlapping bursts roughly each minute,
retained-content assertions, hourly/final reload, screenshot and UI evidence. Sheet
rows intentionally wrap at 1,000; document tokens accumulate. Gaps beyond two minutes,
clock drift or any assertion failure invalidate completion. A final burst must start
after the target duration. Only a 25-hour target can emit `soak-complete`.

Each run freezes source/config/lockfile into `evidence/<UTC>/source` and records JSONL
observations/screenshots. Server events are in `events.jsonl`. Preserve these locally
until findings are reviewed. Long tests may stop if the session, computer or browser
stops; elapsed calendar time alone is never success. Stop with Ctrl-C in its terminal.

Public API references: https://docs.univer.ai/server/collaboration/quick-start,
https://docs.univer.ai/server/collaboration/database-adapters,
https://docs.univer.ai/server/collaboration/identity-and-authorization.

For an independent SQLite restart check, run `node restart-check.ts before`, stop
and restart only this local server without changing its database, then run
`node restart-check.ts after`. It compares read-only normalized Sheet content
and the full Doc body, and saves before/after screenshots. This is separate
from the uninterrupted soak; do not restart the server during that run.
