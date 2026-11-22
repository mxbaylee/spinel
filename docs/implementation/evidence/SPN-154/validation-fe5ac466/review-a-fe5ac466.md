# 🔎 SPN-154 independent fixture-isolation review A

Reviewer: `/root/review_a`, independent nonimplementing reviewer A; **agent review only**.
Exact candidate: `fe5ac4662f884c5637611988c5b8260813b456b4`.
Base: `2dc7871db0a9b7f368cda5fe260af012c70fb6b7`.

## ✅ Decision and rubric

**100/100 for pre-push validation review. No unresolved findings. Every remaining step to 100: none.** No CI-result deductions. This is not a pass for unexecuted native/type/CI work, and does not authorize skipping selected acceptance.

Reviewed the entire delta from `d93321a`, the complete original-ticket outcome retained through prior full reviews, new and historical evidence/source integrity, fixture privacy and emitter contracts, and the existing product/visual source identities.

- Scope/requirements **35/35**: the bounded fixture isolation repair preserves all original reconnect, conflict-copy, content/image, authority, receipt invariance, restart, eviction and outage assertions. It changes when a fixture-wide outage is induced, not product offline policy. The owner-specific physical-phone waiver remains not-run and separate from every other selected acceptance gate.
- Correctness **25/25**: all four reconnect outcomes and both normal queues must be clean before deliberately cutting shared transport. This prevents a test-created outage from interrupting an unrelated document's still-pending background replay while retaining both recovered-original outage journeys in a second phase. No retry, larger deadline or forced recovery success is added. The source-supported lost-ack mechanism is explicitly not claimed as the proved historical Safari cause.
- Regression design/evidence **20/20**: new finite observer checks cover redaction, bounds, schema rejection, storage preservation and unavailable-store isolation at the lowest meaningful layer. The existing lost-ack checkpoint test exercises the unchanged-resume fence deterministically; it does not certify native timing or prove causation. Current-head native acceptance remains required. Local availability and attributed executions are accurately separated below.
- Operations/diagnostics **10/10**: fixture-only projection uses the existing read-only DatabaseSync mode and zero busy timeout; bounded SELECT and strict existing ClientDiagnosticEvent schema reject extra/content fields and unknown names. File identity becomes only a fixture ordinal. Missing/locked/malformed storage or closing errors cannot replace the journey result. Production collection and admission are unchanged. Lossiness and batch-arrival timestamps are explicitly documented; absence cannot prove completeness or causality. Diagnostics inventory updated.
- Maintainability/usability/personas **10/10**: phase separation is small and preserves assertions; evidence records old failures as failures and provenance limits honestly. Owner/Collaborator keep exact preservation checks, guest authority remains unchanged, and Operator gains bounded truthful diagnostic context. No new visible state or product behavior.

## 🧪 Independent exact-head local checks and exception

Initial repeated normal-pressure preflights returned **2**, so no workload started then. Pressure later returned to **1**. The owner explicitly authorized elevated pressure for tiny checks, preferring slower work/CI. I inspected and used the task-only `serial-small-owner-exception.ts` and `guard-small-owner-exception.ts`: shared serial lock/original stale ownership, 15-second deadline, pressure 1/2 permitted, **256 MiB** process-tree cap, 250 ms sampling. No repository policy change or unrelated process termination. Pinned Node **26.13.0**, `NODE_OPTIONS=--max-old-space-size=128`.

- First observer invocation used Node's default file concurrency and hit the small RSS cap: **285 ms**, **264320 KiB**, abort `pressure=1, rssKiB=264320`, runner exit 75. Three assertions completed, two files were cancelled; **not a pass**. Original log/receipt retained as `review-a-fe5ac466-observers.*`.
- Repaired command serialized test files with `node --test --test-concurrency=1 scripts/ci/desktop-transfer-observation.test.ts scripts/ci/desktop-sync-observation.test.ts`: **5/5 passed**, **582 ms**, peak **161152 KiB**, exit 0, no abort. This is the second command attempt after the retained resource abort, not first-attempt acceptance. Receipt/log `review-a-fe5ac466-observers-serial.*`.
- `oxlint --config /private/tmp/spn154-completion/oxlint-node-globals.json --deny-warnings --deny no-undef` on all three changed executable files (`desktop-offline.ts`, `desktop-sync-observation.ts`, its test): **pass**, **438 ms**, peak **63040 KiB**, exit 0, no abort. Receipt/log `review-a-fe5ac466-no-undef.*`. Pressure was 1 before observer execution and 2 after lint; the explicit narrow owner exception applies.

The sole serial slot was released immediately after those checks. The heavier lost-ack case was **not rerun** under the tiny exception. Implementer receipt for that existing deterministic test is separately attributed: 2120 ms / 566000 KiB on the preceding working-tree repair. My historical 61/61 helper pass belongs to `419773ed`, on unchanged product/test blobs. Fresh full selected hosted checks remain required; neither historical nor attributed execution is renamed an exact-fe5 independent pass.

## 🔐 Evidence and historical integrity

Independently checked all **6** manifest entries in `local-reproduction-0e9cf7ff` and all **25** entries in `validation-d93321a` against file SHA-256. Decompressed historical source spec exactly matches Git `0e9cf7ff2dc58473f6b357cf5b7d4a80f2833a68:e2e/spn154-clipboard-reproduction.spec.ts`.

Historical local evidence records trusted PNG paste, correlated unavailable resync, detached original canvas/loading UI, unchanged page marker/persisted body and zero stored images. Recorder HEAD is known; execution-time worktree cleanliness/built-asset binding are not recorded. The canonical record preserves those limits, labels the evidence historical, and makes no original-phone attribution or current acceptance claim. Independent reviewer B's original-image/privacy review remains identified separately; I do not claim to have personally re-viewed those historical screenshots in this review.

The retained d933 Safari report has 18 observed transfer requests with 200/201 and no observed admission overlap; its unexpected normal-Doc recovery remains a failure. It is distinct from the earlier transfer-busy failure. The new sequencing repair is justified by a fixture-readiness risk and retained deterministic protocol behavior, not by inventing an exact cause from insufficient diagnostics. No database or raw live credential archive is added.

## 🎨 Exact-head visual approval

Approve component/application feedback visuals on **fe5ac4662f884c5637611988c5b8260813b456b4**, **agent review only**. Product trees `web`, `src`, `server`, and `lib` are identical to the capture sources; `e2e` is identical to `d93321a`. No exact-fe5 recapture is claimed.

For this review I personally opened all five new original application screenshots in `/private/tmp/spn154-completion/clipboard-d933`: desktop HTML failure light/dark, desktop successful retry, and 390px failure light/dark. Exact source **d93321a16ec3194ce5aeaf44da035eae523614b7**, tested merge **536e8f80976e79645bf793e432574d3f1ccf1ad2**, production run **45048935325**, job **137290091438**, attempt **1**. The supplied summary records **102/102** cases passed, including all **12** clipboard cases on retry **0**. Those execution results are hosted evidence, not my local execution or a claim about the changed Safari fixture.

No visual findings: complete readable failure message in the fixed row, existing light/dark colors and native toolbar geometry, visible retained two-line/bold document after failure, and inserted green image with cleared failure after retry. The existing transient paste-options control partly overlays a line in the success capture, so exact full text preservation rests on semantic checks, not that screenshot alone. Owner/collaborator recovery is understandable; no extra guest identity/authority is introduced; operator presentation remains bounded. Phone-width captures are emulated, not physical-device evidence.

Existing component approval remains: personally inspected 36 originals from `419773ed`, including all 13 image-feedback states in both 390px themes. That approval and its original hashes remain durable and carry forward through identical product sources. Earlier failed-case screenshots stay separate from passing visual journeys.

## ⏳ Remaining gates

Physical-phone confirmation remains **not run, explicitly owner-waived for SPN-154 only**. All other selected native/browser/content/history/persistence/failure checks, including Safari recovery, all seven current-head CI gates, and final landing bookkeeping remain required. Reviews are not substitutes for those results. Verified-head squash merge and safe ticket branch cleanup occur only after required acceptance. Original phone incident cause remains unknown.

## 🧾 Additional inspected assets and local receipts

- `spn154-html-paste-success-light.png`: SHA-256 `5296f2fa7e9b0f92158f07ae726ce723c687c227260f96d8244ab7d52b50015c`.
- `spn154-html-upload-failure-dark.png`: SHA-256 `5d99d8304c15c955d68ad65e95472d36c6a962fac968e16cce0fc64102964eb0`.
- `spn154-html-upload-failure-light.png`: SHA-256 `fe74e57d5f7bdb98b1a7f78ca72d358cba0fb8ee101fb71d43af55df2d1886fd`.
- `spn154-phone-upload-failure-dark.png`: SHA-256 `d925a22d96e28c22558b01b0c9ce99f8555aa45505175eae4eba2d599a6a8a1f`.
- `spn154-phone-upload-failure-light.png`: SHA-256 `a46209dd1fcb12760d7836888d553c1c5259a023f6d714aec4cf4670311a0fe0`.
- `review-a-fe5ac466-observers.json`: SHA-256 `2c155fad1394fa7db83d3c5ee79cecf332bd2b9f2c56ffc0b582c0db12efc88d`.
- `review-a-fe5ac466-observers.log`: SHA-256 `87d9457c9045e9e9e9733ae9834246693cb322023a8bd240cccabbe36a3d2248`.
- `review-a-fe5ac466-observers-serial.json`: SHA-256 `d62b6b52f36ec68f2f9c58e587379d08c0fe8b15ea8bc650bf4955ec302fa461`.
- `review-a-fe5ac466-observers-serial.log`: SHA-256 `dff2e632f54d4fece4dd8ddaa64655836644a03f27e77b0e74e29856acfd7cb1`.
- `review-a-fe5ac466-no-undef.json`: SHA-256 `2b2142bcd1b9d6d87b1ae858ee33eb7faf14fc7c5a044e02e99bb77ecc4458a3`.
- `review-a-fe5ac466-no-undef.log`: SHA-256 `591a6fd9103384cb27d6dec7eb2f9928d9074a8dcf2bd50cbc91c9b6d82927f6`.
