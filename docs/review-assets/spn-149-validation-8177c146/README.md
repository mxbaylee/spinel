# 🔏 SPN-149 — verified current-source acceptance

**All applicable acceptance passed** on source `8177c1466ace555817cf2dbb9a2e5f2b5abc2c62`, base `89e4426dfff1c3469b260305e21180ffd79fdb7f`, tested merge `4b58a794a35c69f0797fe6119b2c5892cc4e107b`. The tested tree `700d5792fa46342491f9c970d01b06dbf4ccfaa4` equals the independently reviewed candidate tree. This immutable record supersedes the pending validation checkpoint in PR #282. It does not claim a merge or branch cleanup has occurred.

## ✅ Exact checks and native outcomes

[Acceptance ledger](acceptance.json) records CI run **43556394015, attempt 1**, all **33 successful jobs**: classifier, 29 execution workers and three aggregates. All seven required current-head checks passed, including Playwright smoke job **132338140309**. The actual required-check query and complete workflow/job metadata are retained under `github/`.

The complete 15-entry coverage plan and all Unit, Lib and Browser aggregate artifacts agree on the source, base, tested merge and canonical plan digest `af72a77ea4afc0cc8b42f163756fbc36a2660ecffc2c47150a662a7185ce6461`. The raw plan digest differs because the serialized file includes its trailing newline; both identities are retained. No selected worker was skipped or cancelled.

The real two-login Chromium journey passed once at retry zero in each existing owner:

- **Development:** job `132330306976`, 10,892 ms. One established target, one closed target, zero open sockets. Protocol close was recorded 48 ms after the revocation checkpoint and 34 ms before navigation.
- **Production:** job `132330306979`, 4,634 ms. One established target, one closed target, zero open sockets. Protocol close was recorded 15 ms after the revocation checkpoint and 20 ms before navigation.

Both exact decoded diagnostics report `contractCompleted: true`, no primary failure, no cleanup failure, no overflow, no observer loss and no reopened connection. The complete case records and byte-preserved diagnostics are under `native/`, with ZIP/report/attachment identities. Passing the unchanged journey separately proves denied access, editor removal, surviving-login continuity, successful queued writes, no later matching frames and exact saved/reloaded native content. These are observer delivery intervals, not a network-latency benchmark. Both runs observed close before navigation; neither establishes an unavailable historical event ordering. The original finite diagnostic sample remains closed; these are ordinary current-source integration acceptance.

The hosted unit owner also passed each of the **19 focused negative controls**, preserved as exact result lines in `coverage/hosted-negative-controls.json`. Current-source recovery passed all 607 tests across 47 files. This source does not contain SPN-158's separate restore-admission fix; an unrelated later pass does not erase its historical failure or prove a causal repair.

Storybook run **43556394025, attempt 1**, passed its build, all five variant workers and aggregate: **eight successful jobs**, two explicitly inapplicable deployment/preview jobs. Each variant checked **1,041 states**, with zero failures. The five manifests and actual checkout identity are retained under `storybook/`. This ticket changes no product UI; these interaction checks are not a substitute for a required visual review on a UI ticket.

The final mobile responsiveness owner passed its seven candidate cases with zero retries, failures or skips. Its three ordinary samples retained exact content/undo-redo integrity, maximum paired flushes of **28.4, 27.6 and 29.8 ms**, and first verified browser-local drains of **462.9, 393.3 and 380.1 ms** (plain 1/2/3). The later-read upper bounds remain descriptive only. This is emulated mobile evidence, not physical-phone evidence. The source-bound comparison, profile/ordinary distinction and artifact hashes are preserved. Sized restore, both callback owners, container, transition, remaining browsers and soaks passed their selected jobs; no production-launch host qualification is claimed.

Desktop offline and Spaces companion workflows were not triggered because this ticket's changed paths do not match their explicit path filters. The legacy BrowserStack workflow is label/manual only; no paid-device or phone acceptance claim is added. The exact workflow sources are retained for this applicability distinction.

## 🔎 Independent source review and local evidence

Two fresh independent nonimplementing reviewers assessed exact source `8177c146`: **100/100 each**, rubric **35/25/20/10/10**, no findings or remaining steps to 100. Each independently ran all 19 controls. Their exact reports and receipts are under `reviews/`; these source grades preceded publication and do not substitute for hosted acceptance.

The first review intake exposed historical numerical grades; neither initial reviewer issued a qualifying grade. Final grading restarted with fresh reviewers. The packet masked only historical numerical grades/rubrics/points in two files while preserving the complete technical diff and all 37 original/masked file hashes. Both intake reports, the masking manifest, both masked files and full diff are retained. No candidate change or discarded numerical grade is hidden.

The candidate itself retains source-bound local checks under `docs/implementation/evidence/SPN-149/current-main-20261114/`: focused controls, full TypeScript, dependency equivalence/boundaries, targeted lint/format, backlog/index and PR checks. Commands shorter than the 200 ms monitor interval have unsampled RSS, not zero memory usage. This archive also retains the final exact-source PR receipt. No local browser execution or new native diagnostic sample was performed for integration.

## ⚠️ Historical failures and evidence limits

The prior immutable [acceptance record at 9392210d](https://github.com/mxbaylee/spinel/blob/9392210d92f3ae706443ca49803c4ea7122322af/docs/implementation/evidence/SPN-149/acceptance/acceptance.json) preserves the original observer investigation and all earlier attempts. Old-source CI `43373411759` failed after an unrelated Space guest export-snapshot reset and cancellation. Its first cause and cancellation trigger remain unproved; the current successful run does not retroactively pass that run or identify its cause.

The [SPN-158 immutable record](https://github.com/mxbaylee/spinel/tree/0cadd4707e659fcc79b26f15ea9802fb7fd45e7f/docs/review-assets/spn-158-validation-bfeb0b23) retains the later old-observer recurrence, CI `43553620429`, job `132321620858`: the first attempt failed, configured retry passed, and `failOnFlakyTests` correctly failed the worker. Only the successful retry retained a trace. Neither a sign-in screenshot nor either current pass reconstructs that missing first-attempt timeline.

Full raw browser archives, job logs, traces and fixture storage remain private local audit inputs or supplementary expiring GitHub artifacts. `downloaded-artifacts.json` records verified ZIP hashes and exact expiry dates. Published native diagnostics contain only event kinds, times, counts and ordinal socket numbers; no URLs, credentials, request IDs or frame contents. `manifest.json` binds every retained payload. `preterminal-checkpoint.json` is explicitly historical; `acceptance.json` is the terminal verdict. Collection-only download/CLI issues are distinguished from test outcomes in `collection-notes.json`.

## 📦 Publication, merge and cleanup boundary

Root must verify this archive and current main/head before publishing the promised tag `archive/spn-149-validation-8177c146-20261114`, then perform the guarded qualifying squash merge. The source branch remains unchanged. The separate completion record will supply the actual squash identity, tree verification and completed cleanup.

[Cleanup plan](cleanup-plan.json) preserves six unique commits reachable only through the prior evidence branch at `9392210d92f3ae706443ca49803c4ea7122322af`. Pin that exact history under `archive/spn-149-prior-acceptance-20261113` before deleting its branch. Recheck every implementation/integration/evidence ref and active PR owner at cleanup time; retain the worktree files, delete only obsolete exact heads, and report any incomplete action explicitly. No cleanup deletion has occurred at this validation checkpoint.
