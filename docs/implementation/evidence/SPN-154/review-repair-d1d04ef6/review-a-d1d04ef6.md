# 🔎 SPN-154 independent diagnosed-retry review A

Reviewer: `/root/review_a`, independent nonimplementing reviewer A; **agent review only**.
Exact candidate: `d1d04ef634f745fcd86329c7e2ec42b69e698ccd`.
Base: `2dc7871db0a9b7f368cda5fe260af012c70fb6b7`.

## ✅ Verdict and rubric

**100/100 for pre-push validation review. No unresolved findings. Every remaining step to 100: none.** No CI-result deductions. Pending current-head native/CI results remain independent acceptance gates.

Reviewed the complete delta from 52572987 and retained full original-ticket scope through prior reviews, including preservation, authority, persistence, diagnostics, historical source limits, all personas and exact visual identities. The proposed narrow retry contract was independently assessed before implementation; this review confirms the committed implementation follows it.

- Scope/requirements **35/35**: one supported native UI retry of a specifically diagnosed safe admission refusal fits sustainable testing and the existing recovery contract. It does not change product admission, automatic retry, offline image rules or guest authority. All prior exact content/revision/image/receipt/outage assertions remain.
- Correctness **25/25**: retry requires busy UI, exactly one observed recovery429, an unambiguous overlapping ordinary bundle, complete observations, finished/closed successful bundle and empty current observed admission. It retains first failure state/screenshot, unchanged checkpoint/request/images/original/receipts, clicks once and shares the original 45-second publication budget. Other errors, ambiguous/lost observations, another refusal or changed retained work fail. The success receipt must bind the same immutable recovery ID and request hash. I checked its hash against server `PortableFiles.recover`; the verified client request includes the Boolean `possibleReplayCrash` field used by the server.
- Regression evidence **20/20**: independently passed all seven observer/policy tests on this exact head and changed-file no-undef. Pure policy uses retained timing/status shape and exercises refused statuses, incomplete release, repeated requests, ambiguity and loss. Current native execution must still prove browser click/timing and outcome.
- Operations/diagnostics **10/10**: observer current-admission ordinals are bounded and content-free; thrown observer reads increment unreadable and therefore cannot authorize retry. No production emitter or route change. Original failures and admitted-at-ingress limitations retained. Tiny owner resource exception observed.
- Maintainability/usability/personas **10/10**: focused fixture policy instead of unrelated product scheduling changes. Owner/Collaborator retain immutable recovery work and supported control, Operator gets precise refusal/identity evidence, Link guest gains no authority. Actual success is labelled supported retry, not automatic-publication success.

## 🧪 Independent exact-head local checks

Pinned Node **26.13.0**, `NODE_OPTIONS=--max-old-space-size=128`, task-local serial/tiny guard with explicit owner pressure1/2 exception, shared lock, 15-second deadline and256MiB descendant cap. Pressure **2** during this review; no unrelated process termination or repository policy change.

- `node --test --test-concurrency=1 scripts/ci/desktop-transfer-observation.test.ts scripts/ci/desktop-sync-observation.test.ts scripts/ci/desktop-recovery-retry.test.ts`: **7/7 passed, first attempt**, test duration555.060958ms; watchdog **620ms**, peak **135232KiB**, exit0/noabort.
- `oxlint --config /private/tmp/spn154-completion/review-b-node-globals.json --deny-warnings --deny no-undef` on all five changed executable files: **pass, first attempt**, **109ms**, exit0/noabort. The six declared existing Node globals include performance; no fixture variable is whitelisted. Peak0 denotes no sample before exit, not zero memory.

Receipts/logs: `review-a-d1d04ef6-tests.*` and `review-a-d1d04ef6-no-undef.*`. Sole slot released before reviewer B's work. No heavy local check attempted. Older helper/native executions keep their original source identities; no historical result is renamed a fresh run.

## 📚 Evidence and causality

The new validation evidence preserves525 Safari's actual429 and overlapping bundle, zero receipt, and earlier fe5 outbox assertion failures. Current admission-at-start snapshots do not prove which request held admission after asynchronous authorization. The source nevertheless establishes that this exact429 occurs before parsing/materialization; one retry is safe only with the additional immutable-state and no-receipt checks now present. Neither that observation nor this repair proves older Safari causes or the original phone cause.

The d933 application results and screenshots are separately source-labelled. All12clipboardcases passed first attempt in both production/development owners; those results do not establish native acceptance of this new fixture. Complete original logs and manifest hashes remain maintained. Earlier no-Retry checkpoints retain their then-undiagnosed disposition, not retroactive passing status.

## 🎨 Exact-head visual approval

Approve unchanged component/application feedback visuals on **d1d04ef634f745fcd86329c7e2ec42b69e698ccd**, **agent review only**, via verified identical `web`, `src`, `server`, `lib`, `e2e` trees relative to52572987. No recapture claim.

Personal application inspection covered five original d933 images from tested merge536e8f80976e79645bf793e432574d3f1ccf1ad2, production run45048935325, job137290091438, attempt1; component approval covers36 originals from419773ed on unchanged product code. Prior reports record exact asset hashes, viewport/theme and limits. No visual findings; 390px emulation is not physical-device evidence.

## ⏳ Remaining gates

Fresh selected native execution must validate this bounded retry implementation and every other current-head acceptance requirement. All seven CI gates, landing bookkeeping, verified-head squash merge and safe branch cleanup remain required. Phone remains **not run, explicitly owner-waived only for SPN-154**. No failed/cancelled/unavailable check is converted to a pass by this review.

## 🧾 Evidence verification

Independently verified **32** manifest file hashes in `validation-52572987`.

- `review-a-d1d04ef6-tests.json`: SHA-256 `69a0bd5128abef6f6a0463e5c879f00844f2e5e3c0fad871b9d4db72e5150612`.
- `review-a-d1d04ef6-tests.log`: SHA-256 `b8d35a45e6140cf0581893122dbf7bcb8758a2ee9e179fdaf98ed9097693a350`.
- `review-a-d1d04ef6-no-undef.json`: SHA-256 `d219755a6cc88d8f9388db95ad0fa15c929fdf77dff7a81b1750200b9e508ae9`.
- `review-a-d1d04ef6-no-undef.log`: SHA-256 `768fd00d72c129fa278a751a1ea97ffc5f5a5ea10972f516b22aabd541317b93`.
