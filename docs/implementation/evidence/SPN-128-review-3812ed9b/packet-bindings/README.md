# 🌷 SPN-128 independent review packet

Review the complete original ticket outcome at **3812ed9b153237b3b6da75fdbf31319f67844d19** against actual main **ec42f0741415e4e712395fb47c30b911bc4e64ea**. This is the full existing PR229 implementation, not only the newly repaired fixture. No desired assessment or prior numerical review result is supplied. Root audits this packet before assigning two independent nonimplementing reviewers.

## 🧭 Scope and authoritative inputs

Start with `base-ticket.md` (exact main ticket), `source/AGENTS.md`, `source/docs/todo/process.md`, `source/docs/run-backlog.md`, `source/docs/testing.md`, `source/docs/product/personas.md`, and `source/docs/implementation/SPN-128.md`. Superseding decisions are in `source/docs/implementation/backlog-workflow.md`, `grooming-2026-10-26.md`, `grooming-2026-10-29.md`, and `grooming-2026-11-02.md`. Original split/authority lineage and current integration constraints are in SPN-112, SPN-124, SPN-131, SPN-138, SPN-158 and SPN-160 records. All four personas must be weighed.

Full L outcome: exact-operation fresh private-host authority; immutable original proof and historical attempts; complete frozen source authentication; retained raw partial tuples without opening them as SQLite; existing rollback/access/negative-evidence reconciliation; new original generation through private trial/commit; prevention of backup-winner replacement and acknowledged-generation/cross-operation replay; bounded process custody/cleanup; supported CLI/runbooks; crash, refusal and current integration verification. Evidence pruning remains separate. No new UI design/state is claimed: existing original-recovered outcome/banner must remain correct. Review code rather than accepting this scope description as proof.

`candidate.diff` is the complete **binary/full-index** base-to-head diff, SHA-bound in `source-manifest.json`. Its bytes are unchanged by blinding. All executable text copies in `source/` are exact committed blobs. Relevant policies and decision records are included. Unchanged binary resources are inventoried; unrelated historical design-review/grooming archives are outside this ticket's review scope. The actual worktree remains the execution source for tests; this packet is an inspection copy, not an installed build tree.

## 🔗 Source and clock bindings to inspect

`source-bindings.txt` retains the parent graph, every changed file's size, the integration delta preserving SPN-158, and exact code locations. The merge candidate65b7c982 has parents c04aba84 (scope checkpoint descended from a6dd085d) and ec42f074 (actual main). Final3812ed9b adds maintained documentation/evidence only. Main's completed SPN-098 and November14 grooming state are retained; SPN-128 is the only additional completion. Main's SPN-138 readiness owns the folder fixture; the consumed SPN-130 reservation is not resurrected. Index changes are generated.

Inspect these clock relationships without weakening their assertions:

- `src/shared/restore.ts`: original operation lifetime30minutes.
- `src/server/maintenance/restore-crash.integration.test.ts`: initial restart offset derives from `before.intent.authority.expiresAt`; subsequent restart from `attempt.deadline`; original strict grant-after-expiry assertions remain.
- `restore-crash-clock-fixture.ts`: offset calculation preserves earlier virtual advances.
- `restore-crash-fixture.ts`: supervisor fixture's Date.now receives that offset and passes the same environment offset to its application fixture.
- `restore-crash-app-fixture.ts`: application Date.now applies that same offset.
- `restore-crash-clock.test.ts`: persisted5/30minute deadlines, old six-minute negative control, later cold grant and already-expired authority.

Production authority, lifetime and clocks are unchanged by the resume repair. Frozen-source fingerprint and reconciled-output fingerprint differ intentionally; verify unchanged user content/access plus the independently witnessed source and final prepared output rather than asserting false raw fingerprint equality after reconciliation.

## 🔬 Evidence and limits

`source/docs/implementation/evidence/SPN-128-resume/provenance.json` binds the local checks to source65b7c982. `decoded-evidence/SPN-128-resume/` contains all six decompressed local logs; source copies retain watchdog receipts and the original nine-failure excerpt. `historical-evidence/` includes all text from the three immutable evidence archives: local2fcbbec7, local-a6dd085d and previous-ci740e97cc. Archive identities and original/copy hashes are in the manifest; essential preserved findings remain available after temporary CI traces expire.

Local observations:30 focused tests passed,21 Linux-only cases skipped; five privacy controls passed; integrated typecheck, full dependency/lint/format, backlog and exact-title PR shape passed. Index/short privacy commands ended before the first RSS sample, which does not mean zero memory. No Linux process acceptance was run on this Mac. These results are not final hosted acceptance or independent review.

Original current-head CI41501654342 attempt1 recovery job125560262408 failed9/660 tests (651 passed), all original-authority expiry ordering. The six-minute fixture setup is stale against persisted30minute authority; the new deterministic control detects that mismatch. Actual corrected Linux crash acceptance is still pending. Its mobile responsiveness worker was cancelled; Unit tests and Playwright smoke aggregates failed. The original supervised-restore worker passed, which cannot reconstruct the earlier uncaptured ECONNRESET. Older mobile116.3ms/100ms, snapshot-reset and preparation failures keep their original dispositions. No unexplained historical failure, abort or passing retry is silently converted to a repair.

Required outstanding acceptance: actual Linux interrupted restore/cold-command crash cuts, custody/grant/refusal/replay/cleanup, selected browser/native/platform runs, all seven current-head CI gates and two independent complete-head reviews. Current policy does not deduct points for CI results; reviewers do independently run relevant feasible local tests and evaluate implemented regression protection. List every actionable step to a complete assessment, with location, points at stake, concrete change and local/hosted/owner availability; do not infer approval from prior source commentary.

## 🧪 Reproducible local checks and coordination

Candidate: `/Users/mxbaylee/projects/spinel-spn-128-production`, clean head3812ed9b. Pinned node: `/tmp/spinel-dependabot-2026-11-11/node-v26.13.0-darwin-arm64/bin/node`. Guard: `/tmp/spinel-dependabot-2026-11-11/watch.ts <unique-name> <command> ...`, from candidate cwd; it runs scripts/serial.ts with continuous normal-pressure/2GiB/8minute monitoring. Root owns allocation of the single Mac workload slot. Do not run Linux-only tests on Mac or duplicate hosted matrix work.

Focused command: `node node_modules/vitest/vitest.mjs run --config /tmp/spn128-vitest.config.ts --configLoader native --cache=false src/server/maintenance/restore-crash-clock.test.ts src/server/maintenance/restore-cold-custody.test.ts src/server/maintenance/restore-cold-state.test.ts`. Evidence command: `node --test scripts/ci/maintenance-evidence.test.ts`. Typecheck uses `GOMEMLIMIT=640MiB GOGC=50 GOMAXPROCS=2 node node_modules/typescript/bin/tsc -p .`. All commands run through guard/serial with pinned node on PATH.

Private node_modules overlay resolves candidate workspaces locally and third-party packages through the unchanged pinned donor. Package/lock bytes match; caches/config are private. Do not install into, alter links in, or write caches to the shared donor. Reviews are read-only; implementing agent owns fixes. No push, metadata edit or merge is authorized by this packet.
