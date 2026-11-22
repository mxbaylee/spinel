# 🔎 SPN-154 independent review B — native fixture isolation

**Exact reviewed head:** `fe5ac4662f884c5637611988c5b8260813b456b4`

**Base:** `2dc7871db0a9b7f368cda5fe260af012c70fb6b7`

**Reviewer:** `/root/review_b`, independent nonimplementer; **agent review only**.

**Grade: 100/100.** Approved for validation publication. No actionable findings. Every remaining repair step to 100: **none**. This is not merge readiness or CI acceptance.

## 📋 Rubric and scope

- **Scope 35/35:** Rechecked the original main ticket and current complete L outcome, alongside the retained full implementation reviews. Native image paste, preserved content/page, controlled failure feedback, authority and cancellation coverage remain intact. This delta repairs selected acceptance sequencing and preserves evidence; it does not redesign sync or change offline image policy. The explicit one-ticket physical-phone waiver remains accurately distinguished from execution.
- **Correctness 25/25:** Both recovered-original outages now occur after all four reconnect outcomes and a fresh clean-checkpoint assertion for both normal items. Existing original/copy reopening, content, image, receipt, authority, restart and storage-loss assertions remain. The source-proven interference risk is removed without claiming it caused either prior Safari failure. The fixture-only observer opens the existing diagnostics database read-only, projects an exact finite diagnostic vocabulary and fixture ordinals, caps output at 256 records and isolates unavailable/invalid observations from acceptance. Lossiness and receipt-time limits are documented.
- **Regression coverage 20/20:** Independently executed all five observer tests and a targeted undefined-name check on this exact clean commit. Tests exercise actual bounded projection, schema/content rejection, storage preservation, unavailable-store isolation, overlapping transfer observation and exception isolation. The existing deterministic lost-acknowledgement test supplies the lower-layer protocol evidence, with its separate implementation-run receipt retained. Fresh native acceptance is still required. Existing tests are selected through the scripts/ci wildcard; no new broad workload is added.
- **Operations 10/10:** Retained first Safari failures and exact source/run/tested-merge identities are not converted to passes. Historical local reproduction has faithful source and artifact hashes and explicit cleanliness/build-binding limits. Resource restrictions, the owner-authorized tiny-workload exception and actual test receipts are accurately reported. No CI-result deduction.
- **Maintainability 10/10:** Small fixture phase separation, no product changes, no expanded retry/deadline, bounded existing-diagnostics projection and maintained diagnostics inventory. No new framework or production observer contract.

## 🧾 Source and evidence inspection

Re-read repository process/testing guidance and original base ticket. Full implementation review findings and prior independent checks remain in `review-b-419.md`, `review-b-70a.md`, `review-b-52f.md` and `review-b-d933.md`. Verified all `web/`, `src/`, `server/` and `lib/` contents remain identical to reviewed `419773ed`; this delta is fixture/evidence/documentation only. The prior full source/authority/cancellation integration review therefore remains applicable.

Verified every entry in the new retained manifests: 25 files under `validation-d93321a` and six under `local-reproduction-0e9cf7ff`, including lengths and SHA-256 hashes. Historical extract files are byte-identical to the independently inspected scratch extract; decompressed recorder spec again matches Git source `0e9cf7ff2dc58473f6b357cf5b7d4a80f2833a68`. Its original observation/spec/image hash checks, credential inspection and visual inspection are retained verbatim in the committed independent review. No application or diagnostics database is included. Earlier historical source archives remain unchanged with their source identities and no database/ancestry contents, as verified in the earlier full review.

The d933 Safari artifact proves unexpected normal-Doc recovery publication, with 18 observed successful transfer responses and two recovery receipts. It does not prove lost-ack causality. Account-wide replay plus the old global transport cut establishes an unintended possible interleaving; the existing checkpoint test demonstrates that an accepted submit with a lost acknowledgement can retain stale attention. Neither fact identifies the old runtime cause. The new diagnostic projection remains lossy, uses batch-receipt timestamps, and cannot prove server-commit/ack ordering or exonerate a mechanism through missing events.

## 🧪 Independent exact-head checks

Parent granted the exclusive local slot. Per the explicit owner authorization relayed by the parent, only tiny checks used task-local wrappers allowing macOS pressure 1/2, a 256 MiB descendant cap, 250 ms sampling and a 15-second serial deadline. The shared lock and original stale-owner lifetime are retained. I inspected both wrappers and identified that a detached test child could escape the outer timeout; the parent changed the tiny guard to `detached: false` before my execution. No repository execution policy or product code was changed. No heavy suite/browser/build ran locally.

Pinned Node 26.13.0 commands:

```sh
export PATH=/Users/mxbaylee/.nvm/versions/node/v26.13.0/bin:$PATH
node /private/tmp/spn154-completion/serial-small-owner-exception.ts node /private/tmp/spn154-completion/guard-small-owner-exception.ts review-b-fe5-observers node --test --test-concurrency=1 scripts/ci/desktop-transfer-observation.test.ts scripts/ci/desktop-sync-observation.test.ts > /private/tmp/spn154-completion/review-b-fe5-observers.log 2>&1
node /private/tmp/spn154-completion/serial-small-owner-exception.ts node /private/tmp/spn154-completion/guard-small-owner-exception.ts review-b-fe5-no-undef-corrected node node_modules/oxlint/bin/oxlint --config /private/tmp/spn154-completion/review-b-node-globals.json --deny no-undef scripts/ci/desktop-offline.ts scripts/ci/desktop-sync-observation.ts scripts/ci/desktop-transfer-observation.ts > /private/tmp/spn154-completion/review-b-fe5-no-undef-corrected.log 2>&1
```

- Observer tests: **5/5 passed first independent attempt**, zero skipped/cancelled, 6593.752708 ms test duration, 7124 ms watchdog, peak 156544 KiB, exit 0/no abort.
- Undefined-name check: **passed**, 631 ms watchdog, peak 63520 KiB, exit 0/no abort.
- The first no-undef invocation used the prior five-global config and failed solely because expanding its files to the transfer observer required Node's `performance` global. Its receipt is retained as `review-b-fe5-no-undef.{log,json}` (224 ms, no abort; RSS 0 means no sample). The corrected scratch config declares Buffer, URL, process, console, structuredClone and performance read-only. No source changed to resolve this checker-configuration failure.
- Successful receipts are `review-b-fe5-observers.{log,json}` and `review-b-fe5-no-undef-corrected.{log,json}` in `/private/tmp/spn154-completion`.
- Rechecked exact HEAD and clean worktree afterward. Shared serial lock was absent; slot released to parent.

Earlier independent helper/prepared-image **61/61** remains attributed to `419773ed` with unchanged source/test blobs, not relabelled as fe5 execution. Likewise the d933 checks and working-tree lost-acknowledgement run retain their original identities. No full Typecheck or full lint pass is asserted by this targeted check.

## 🚧 Remaining acceptance

Fresh final-head selected native/hosted acceptance, all seven required CI gates, required independent visual/source records, landing bookkeeping and cleanup remain required. Prior Safari failures are retained and unwaived. The physical-phone test is **not run**, explicitly waived only for SPN-154 by the owner; historical local desktop evidence and 390px emulation are not physical-phone results or proof of the original phone cause. This review does not certify an unperformed platform check or a new visual inspection.
