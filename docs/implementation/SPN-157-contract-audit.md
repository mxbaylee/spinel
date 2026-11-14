# 🛟 SPN-157 full-contract audit

## 🧭 Scope, frozen inputs and disposition

**2026-11-14; audit complete, proposed acceptance pending independent review and landing.** The accepted
[investigation method](SPN-157.md#-bounded-investigation-method-and-full-contract-audit)
retains **L** and every original behavioral/negative requirement. This is the
single acceptance ledger for that method, not new instrumentation or a substitute
for independent review. No runtime source is changed by SPN-157's audit.

- Original specification: [main 754e6531](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/docs/todo/SPN-157.md),
  Git blob `d983f6a36284a1f50c454f9da4530d811ff2af00`, SHA-256
  `13b1803b9ee1154bd6e35eb9b9f58b0942fa7466125e589899fb3a528d5224c6`.
- Prior investigation: commit `9ca506c558820e5756aaeb518510f40c75c2e6dd`,
  `docs/implementation/SPN-157.md`, Git blob
  `02248dcf98c09f69b2f17f50a573f978657712ee`, SHA-256
  `44f40806d9902927c91a500ae950010cea17f11feaf351bb2730c9a3fab5d271`.
  That commit remains an ancestor of this audit; its conclusion is not rewritten.
- The old implementation branch remains at
  `44f9a5365fe290236b882606933e63b8ef317363`. Its diagnostic work is not relabelled
  as the complete recovery outcome or imported over accepted SPN-160.
- Local frozen copies and source/plan comparison receipt are in
  `/tmp/spn157-contract-audit-20261114/`. They supplement the pinned repository
  identities. The durable [source/plan comparison](../review-assets/spn-157-contract-audit/source-plan-audit.json)
  retains the checked source blobs, frozen hashes and workflow difference.

**Current result:** all original behavioral/negative obligations below are covered
by inspected assertions and exact first-attempt native results, with durable
source, log, plan and cleanup evidence verified. No uncovered obligation or
supported current runtime defect remains in this bounded audit. Select the
accepted method's **bounded non-recurrence** outcome. Historical cause remains
unknown; no historical causal repair, universal defect absence or “fixed by
SPN-160” is claimed. Normal landing bookkeeping is proposed in this candidate;
SPN-157's actual completion and release of SPN-098 remain conditional on independent
exact-head review, applicable current-head gates and merge.

## 🧪 Native evidence and source boundary

**S** means supervisor job
[132380865473](https://github.com/mxbaylee/spinel/actions/runs/43572824567/job/132380865473),
**R** means recovery job
[132380865510](https://github.com/mxbaylee/spinel/actions/runs/43572824567/job/132380865510).
Both are **run 43572824567, attempt 1**, source
`5e72d33ac9cb3a86b3496345209493d6c86e469c`, base
`754e65317744e5ce97ede501935c6586e4875f2a`, tested merge
`c603a21de6446d623145589eca811ab6dfb38152`, source/tested tree
`f9cf0bc6e26551713a0d66f5b273d944c44a10fc`, Ubuntu/Linux, Node **26.13.0**.
S passed **131/131 in 258.22 s**; R passed **619/619 across 49 files in 258.03 s**.
Neither summary reports skipped/failed tests. Fast individual names may be omitted
by Vitest's successful reporter; a named file's complete count, unsliced command
and inspected parameterization identify those cases without inventing timings.

Every source reference below is pinned to main `754e6531`. Its cited maintenance/backup
tests, fixtures and runtime are byte-identical in feedback source `5e72d33a`. The source
audit also compared the adapter, manifests/lockfile, Node pin, Vitest configuration,
PID wrapper, plan/aggregate implementations and their tests. The CI workflow has
one known difference: feedback adds `spn098-feedback-pair.json` to browser artifact
retention. The source audit initially detected that difference rather than claiming
whole-file identity; native commands, job dependencies and aggregate wiring are
unchanged. Feedback runtime is exercised by the real application child on `5e72d33a`;
it is not imported into the SPN-157 branch. See the earlier
[candidate-specific analysis](SPN-157.md#-feedback-source-investigation-checkpoint).

**Selection and aggregate:** the retained full plan selects `unit-tests`; its
`paths:null` triggers conservative full coverage, not missing-work inapplicability.
Raw `ci-plan.json` SHA-256 is
`8f506fb37a01c4e233efea31dcdda6ee54cef158c41de8690b7a2de4d0dd62ea`;
canonical plan digest is
`90b47b80b05d2211d3660bc4f6b7cf7e35dc09c99c1f27f47218ac87b3af8b16`.
The agent independently recalculated the digest, checked the plan's base/head/tested
identity, and compared the original `ci-results-unit.zip` member with its retained
decoded copy. Report SHA-256 is
`ef8fc98e18b7076bdfb1bf99131f641941b256ff8150577c20aafe9233c09d36`;
it records `passed:true`, the same plan digest/source and selected unit success.
[Required Unit tests 132383697527](https://github.com/mxbaylee/spinel/actions/runs/43572824567/job/132383697527)
and all three unit partitions, including remaining job 132380865589, completed
successfully on attempt 1. This is not an all-gates verdict for SPN-098 or SPN-157.

S runs exactly `vitest run src/server/maintenance/supervisor.test.ts`; R runs
`vitest run src/server/maintenance/ src/server/backup/ --exclude
'src/server/maintenance/supervisor.test.ts'`, both through the existing
[PID-namespace owner](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/scripts/ci/pid-namespace.ts).
There is no test-name selection, retry invocation or altered deadline. The wrapper
asserts Linux, Tini PID1, isolated PID/mount namespaces, original nonroot UID/GID,
zero capabilities and retained network namespace before running the unchanged
command. It forwards command failure; namespace teardown contains even detached
descendants. This complements, rather than replaces, the per-case closure checks.

The [published terminal archive](https://github.com/mxbaylee/spinel/tree/d34f2ff3cf2b33217e6d8959d97ba2af483fd692/docs/review-assets/spn-098-validation-5e72d33a)
is commit `d34f2ff3cf2b33217e6d8959d97ba2af483fd692`, direct parent source `5e72d33a`,
tag `archive/spn-098-validation-5e72d33a-20261114`. The delivery manager independently
verified its publication, all 198 payload hashes, original artifact bytes and live
run identities. This audit separately decoded both stored S/R logs and matched
both raw hashes to the already inspected originals; the
[receipt](../review-assets/spn-157-contract-audit/receipt.json) records stored/decoded
hashes. The canonical checkpoint also retains those hashes. The same archive's
`ci-plan.json`, original `ci-results-unit.zip`, original JSON report and job API
pages bind the tested SHA, plan digest, selected partitions and aggregate. Existing
failed/comparator evidence below retains its original verdict.

## 🔍 Assertion and negative-control owners

Each owner identifies the actual invariant a wrong implementation would violate.
These are existing controlled inputs, not claims that new mutation runs occurred.

- **A1 — durable crash and original rows, S.**
  [supervisor.test.ts:1070](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor.test.ts#L1070)
  observes the armed durable phase before sending real SIGKILL, awaits exit,
  starts a replacement and requires `recovery-required`, `readyToResume:false`,
  closed workspace handles and exactly one `writes.value='original'` row.
  `supervisor.ts:758` writes the journal before its transition callback;
  `supervisor-fixture.ts:41` reports the phase and blocks before further progress.
  `seed-fixture.ts:7` creates the original row in an exited seed process. All six
  durable phases pass S, including running **696 ms**. The assertion preserves
  the original row, not byte identity of a database that legitimately receives
  fixture writes before the cut.
- **A2 — uncertain ownership cannot open SQLite, S and R.**
  [supervisor.test.ts:679](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor.test.ts#L679)
  kills the parent after **0 or 2 actually received handles**; requires child PID
  disappearance, no `.opened` marker, closed descriptors and successful fresh
  live/cold lease acquisition. `ownership-fixture.ts` creates the marker only
  after real `receiveWorkspaceOwnership` resolves. Both cases pass S. The
  before/during restore-barrier cases require receiver exit1, no open marker,
  unchanged database bytes and closed handles; during also requires an actual
  late listener's close event. Sender before/during/acknowledgement controls
  reject and keep parent listeners listening. R's `ownership.test.ts` **6/6**
  additionally keeps its success promise unresolved for wrong transfer ID/nonce
  and local callback completion, rejects missing `held` at the unchanged deadline,
  and verifies timer/listener cleanup and parent holds.
- **A3 — physical closure and original stop budget, S.**
  [supervisor.test.ts:510](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor.test.ts#L510)
  holds real path/inode descriptors: closure stays pending while held, succeeds
  after release, and never signals their unrelated owner. Persistent and late
  closure, including a successful scan crossing the deadline, must reject within
  the unchanged stop contract. A competing cold holder prevents reconciliation
  from publishing a control socket and remains alive. These named cases pass S.
  [Persistence-failure cleanup:1050](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor.test.ts#L1050)
  also requires owned handles closed while an unrelated replacement-root note and
  socket remain intact. These outcomes detect false closure, not just error text.
- **A4 — authenticated archive and exact candidate/original data, S and R.**
  [supervisor.test.ts:2075](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor.test.ts#L2075)
  uses the complete-app seed, encrypted archive and `prepareRestoreArchive` with
  expected bytes/hash/origin/image. At `:2420` admission retains custody and the
  caller's source is disposed. At `:2734`, original witness/frozen fingerprints
  agree and differ from the archive; archive hash remains exact; prepared
  candidate/original fingerprints differ. Each image's actual byte length and
  SHA-256 match its manifest; separate exited observers read **Archived folder**
  versus **Current folder**, with zero sessions, and observation leaves bytes
  unchanged. At `:2910`, the selected live database is read after supervisor
  closure and must contain the selected content, even after failed release.
  R's [verification.test.ts:96](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/backup/verification.test.ts#L96)
  **17/17** includes actual encrypted verification, exact source/prepared bytes,
  native content and access structure. Wrong key, wrong image, mismatched transfer
  bytes/hash, malformed semantics and bounded worker failure reject while source
  bytes remain unchanged and candidate/verification staging is removed. These
  controls would fail if bad inputs were admitted, even with the expected message.
- **A5 — both orderings and private admission, S.**
  [supervisor.test.ts:2190](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor.test.ts#L2190)
  buffers actual `held` until private-ready, requires the same selected PID and
  durable `trial-opening`, probes real HTTP503, injects ordinary-ready and wrong
  nonce and requires `starting`/nonresumable. Delivering valid readiness still
  cannot make it resumable until buffered ownership is released. At `:2708`
  both positive orderings must reach candidate-committed and running;
  `ownershipReordered` must be true only for readiness-first. S reports
  ownership-first **6,917 ms**, readiness-first **7,092 ms**. A premature or missing
  barrier cannot satisfy all these state and actual HTTP assertions.
- **A6 — commit, release and fail-closed uncertainty, S.**
  [supervisor.test.ts:2240](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor.test.ts#L2240)
  injects wrong fingerprint, rejected/early release, lost paused publication,
  lost commit publication and clock expiry after final scan/running write. All
  corresponding named S cases pass. At `:2690` failures must reach recovery-required
  and child-null; uncommitted failures retain trial-frozen custody. At `:2850`
  journal references, inode/generation and barrier agree with the selected outcome;
  release is absent while a barrier remains, otherwise its captured durable job
  is terminal and main is paused with cleared restore references and accepted ACK.
  Failures require closed handles and `runningPublished:false`; successful release
  retains the ordinary authentication guard (real unauthenticated HTTP401), then
  closes ownership and preserves selected content. No refusal can restore old
  content after a durable candidate winner. At `:2940`, corrupted committed
  bindings/competing jobs retain barrier, exact job/database bytes and refuse
  verification. Existing explicit publication-cut retries test idempotent recovery,
  not repetition of a failed acceptance run.
- **A7 — private trial capability and expired authority, S and R.**
  [restore-trial.test.ts:199](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/restore-trial.test.ts#L199)
  **8/8 in R** keeps root, health, session and management endpoints at HTTP503
  before exact private release. Early release is rejected; removal of its barrier
  plus paused binding permits release; repeat release is harmless. Running,
  unavailable or expired state cannot rehabilitate readiness or HTTP admission.
  Wrong bytes/policy cause nonzero real-child exit, rejected ready/listening,
  unchanged database bytes and no WAL/SHM/journal. This child-boundary fixture
  explicitly does not stand in for durable commit; A6 owns that. S's authority
  cases at `:825`, `:1762`, `:1800` and `:1926` refuse expired/revoked/foreign
  actor/session/credential/challenge/generation proof without renewing live state.
  R's `restore-authority.test.ts` **16/16** checks guarded-read proof capture,
  exact expiry and each changed authority field. S's custody/stop-plan expiry
  cases at `:3260` and `:3520` withhold ACK/stop challenge; revocation during drain
  preserves hashed raw original custody and refuses frozen authority.
- **A8 — failed trial and interrupted custody remain recoverable, S.**
  [supervisor.test.ts:2661](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor.test.ts#L2661)
  checks failed-stop timeout/memory/publication-deadline: real selected child
  receives only SIGKILL, exits with that signal, releases resources, and leaves
  recovery-required, barrier and exact original stop witness; no fabricated
  fingerprint, capture, rollback or outcome is accepted. All three named S cases
  pass. At `:2770`, failed trial custody and frozen image retain exact file sizes,
  SHA-256s and witness/generation bindings; failed publication cannot allocate a
  second slot. Original-recovered/original-long-recovery retain distinct original
  attempt/epoch and exact original image bytes. At `:3030`, expired restart may
  reconcile a historical winner without granting a new trial or operation, and
  interrupted cleanup preserves intervening edits. R's actual restore-crash
  integration also passes all **11/11** cuts, including private-open, commit,
  postcommit and original recovery; it supplements the required S scenarios.
- **A9 — first failure cannot be mistaken for successful coordination, R and S.**
  [supervisor-test-control.test.ts:14](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/src/server/maintenance/supervisor-test-control.test.ts#L14)
  **4/4 in R** requires synchronous/asynchronous pre-barrier rejection immediately,
  zero elapsed fake time, exact rejection identity, and removed listener/timer;
  a late barrier cannot turn rejection into success. A wrong barrier remains
  pending; the matching barrier tolerates only subsequent crash rejection. The
  missing barrier fails at the unchanged ten-second deadline. S's actual A1
  uses this helper before SIGKILL. R's A2 controls separately freeze receipts,
  ignore late callbacks/getter/cyclic causes, omit the database path and preserve
  parent holds. These diagnose failures without substituting for A1–A8 behavior.

## ✅ Original requirement ledger

The following entries cover each original scenario clause, Rule and Verify item
in the frozen `754e6531` specification. S/R refer to the exact run/source above; A1–A9
identify the exact assertions and their substantive detecting negatives.

1. **Story — preserve documents and truthful operating state across stopped
   processes or readiness-first.** A1/A4/A5/A6; S actual rows, selected images,
   phase, HTTP refusal and successful private release. A2/A6/A7 prevent falsely
   writable or ready success. Verified behavior, historical cause unknown.
2. **Scenario 1 Given — durable running phase and original rows.** A1;
   real journal write precedes the observed barrier; seed exits with original row.
   S running 696 ms. A9 rejects a failed pre-barrier transition immediately.
3. **Scenario 1 When — process killed and supervisor reconciles.** A1;
   actual SIGKILL/exit followed by a new supervisor, not an injected exception.
   S six-phase matrix; A3 separately refuses premature or late closure.
4. **Scenario 1 Then — maintenance, original rows intact, orphan handles closed.**
   A1 exact original row count and closed-handle scan; S. A2 proves no open after
   partial transfer; A3 proves real held descriptors cannot be reported closed.
5. **Scenario 1 And — uncertain ownership fails closed without writable/false-ready
   admission.** A1/A2/A3/A7; S nonready recovery and absent open markers; R actual
   HTTP503 and wrong-capability child refusal. Negative inputs alter ownership
   or authority itself, not the expected error string.
6. **Scenario 2 Given — complete application and authenticated archive validated.**
   A4; S complete real application and retained authenticated source; R 17/17
   verification, including wrong-key/source-size/hash and malformed-data refusal.
7. **Scenario 2 When — readiness before ownership.** A5; S actual held interception
   and readiness delivery, with proof of trial-opening and nonresumability before
   held delivery. Ownership-first remains a separate positive control.
8. **Scenario 2 Then — selected candidate commits and releases within existing
   deadlines.** A4/A5/A6; S exact candidate data and terminal/release snapshot,
   running publication and unchanged 20s start/30s restore budgets. A6/A7 reject
   expiry, early or failed release. No elapsed-time improvement claim is made.
9. **Scenario 2 And — failed/interrupted handoffs preserve data, authorization,
   recoverable ownership and truthful failure diagnostics.** A2/A4/A6/A7/A8/A9;
   S/R physical closure, original/candidate bytes and wrong-input refusal, plus
   bounded immutable context. No original failure attribution is inferred.
10. **Rule 1 — SPN-160 evidence prerequisite, full L and original acceptance retained.**
    SPN-160 is on base754; A9 is only its first-failure/control contribution.
    A1–A8 supply the recovery behavior. Main specification and investigation `9ca506c5` scope and old44 branch remain
    frozen. The earlier M + L split remains provenance; this is the full L audit.
11. **Rule 2 — source-specific failures, separate ownership and own-head gates.**
    E1 retains the failed098 verdict and comparator. The source-specific audit
    distinguishes the minimal crash child from the complete feedback application;
    no independence follows merely from unchanged supervisor code. SPN-158 is
    already on main `754e6531`; SPN-090 must integrate it and satisfy its own gates.
    SPN-098 dependency removal is conditional landing bookkeeping; neither consumer
    is merged or granted an exception here.
12. **Rule 3 — size complete IPC/kernel/persistence/authority/cleanup/native outcome.**
    A1–A8 and E2 cover those boundaries together; estimate stays L. No new
    architecture requirement or separate unfinished behavioral slice was found.
    A real gap would keep completion blocked, regardless of its code size.
13. **Rule 4 — diagnose/repair demonstrated causes; preserve history, no weakening.**
    The explicit method decision permits bounded non-recurrence only with this
    complete ledger, unknown historical cause and no supported current defect.
    This revises the stopping method openly; it does not claim diagnosis or repair
    that did not happen. E1 keeps both failed cases and the uncorrelated timeout.
    No test was rerun, deadline increased, assertion weakened or skip added here.
14. **Rule 5 — sustainable existing owners and unchanged guest/management authority.**
    A1–A9 reuse existing lowest meaningful owners: controlled protocol/state tests
    and Linux process integration. No browser/device test is invented for prose.
    A7 and unchanged runtime retain access boundaries; persona effects are in the
    canonical decision. No new role, endpoint or management permission is added.
15. **Out of scope — feedback, phone, list replay, general redesign/deployment.**
    No such code enters this branch. Feedback's actual candidate is evidence of
    the consumer path, not an implementation dependency to bundle into SPN-157.
    SPN-098/090/156 and the deployment stage retain their own acceptance.
16. **Verify 1 — exact rows, authenticated archive, commit/release, orphan closure,
    fail-closed controls.** A1–A8 cover each named invariant in S/R. The existing
    shared fixture extensions are inspected and exercised; adding duplicate
    cases merely to give SPN-157 a runtime diff is not necessary. Wrong receipt,
    partial handoff, wrong bytes, revoked/expired authority and failed release
    controls must fail the actual acceptance outcome.
17. **Verify 2 — durable/process readiness, bounded safe context, complete cleanup.**
    A1/A2 observe actual barrier/IPC receipt; A3/A8 observe descriptors, exit and
    selected process resources. A9 preserves safe context before cleanup. E2 maps
    success/failure/interruption resource ownership; no sleep substitutes for
    readiness. No standalone historical process census is invented.
18. **Verify 3 — distinct deterministic/Linux owners, unchanged deadlines and
    complete dependency routing.** S/R commands, namespace checks, exact source
    comparison and full plan above cover all selected maintenance/backup paths.
    E3 maps the fail-closed aggregate and its negatives. Mac configuration evidence
    is explicitly not native acceptance. No CI selector is changed by this audit.
19. **Verify 4 — original/comparator identities, capability checkpoint, negatives
    and current-source Linux evidence preserved.** E1 and the canonical checkpoint
    retain full source/base/tested/tree/run/attempt and failure dispositions;
    A1–A9 map the actual negative results; E3 binds current selection/aggregate.
    The published terminal archive and retained supplemental log bind those
    observations; no acceptance relies only on a scratch path.

## 📦 Evidence, cleanup and finalization

**E1 — retained history.** The original source `2204b8c4`, base `ebf0842f`, tested `62bc0229` and tree `d6bb8192`
identities and full failed/comparator observations remain in the
[canonical first-failure record](SPN-157.md#-retained-first-failure-and-comparator).
Both original complete logs were read for this audit. Failed log raw SHA-256:
`807a4753b20e2839675028ee23ec8dc974a410dbcde2fc37d7d6062d28087ff0`;
successful comparator raw SHA-256:
`c25df11a075f0743dcff2c6c0bb3921d42476f8a7ec4cf62ec53fc4f5e99a6ae`.
The failed aggregate remains failed. Both raw logs were also compared byte-for-byte
with their compressed originals in
[5e1b7a9f](https://github.com/mxbaylee/spinel/tree/5e1b7a9fac17c69ff9174caa9da9f8d13713737d/docs/review-assets/spn-098-failure-43544143900);
[the historical archive receipt](../review-assets/spn-157-contract-audit/historical-archive-audit.json)
retains both stored/decoded hashes. The original comparator's wider acceptance
archive is [32a4694e](https://github.com/mxbaylee/spinel/tree/32a4694e773e3bcabd6472fd27747b044ee7b0dc/docs/review-assets/spn-098-acceptance-2204b8c4).
The first SPN-160 instrumented main-only run 43567177401, source `a623fb42`,
base `b1b18165`, tested `0df4921`, supervisor job 132363730052 (131/131) and
recovery job 132363730015 (619/619),
is separate current-contract evidence. It neither exercised feedback source nor
diagnosed the original failures; the later S/R consumer run closes that source gap.
The previous Mac Linux-only attempt remains an unsuccessful reproduction, not
acceptance. The later same-connection FULL comparison has only its stated Mac
configuration meaning. Missing historical stage/child/progress inputs remain
unavailable, and are not fabricated from test duration or a later pass.

**E2 — cleanup ownership.** `supervisor.test.ts:60` awaits registered cleanup in
reverse order and restores spies. Its fixture registers directory removal first,
then supervisor/child closers, so closure precedes deleting databases. A1 awaits
the killed and restarted children; A2 awaits orphan exit and reacquires leases;
A3/A8 require actual closed handles and protect unrelated processes. Complete-app
positive/commit cases explicitly close the supervisor before reading selected
content in exited observers. Failed cases assert child-null/closed handles or
fail-closed retained custody, and `closeOwned` waits queued operations, stops the
recorded groups, checks descriptors, closes servers and releases the journal.
`restore-trial.test.ts:56` registers child SIGKILL/exit before journal/directory
cleanup. Verification negatives require no leftover private staging. Portable
ownership/control tests close real listeners, settle promises, remove temporary
directories, reset fake timers and require zero listeners/timers. The successful
native commands also terminate their isolated PID namespaces. This is the actual
cleanup contract/evidence; no separate per-process census from the historical
failure or current job is claimed.

**E3 — missing/failed selected work cannot pass.**
[ci.yml:227](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/.github/workflows/ci.yml#L227)
requires the entire unit matrix through `needs.unit-test-run.result` and an
always-run aggregate bound to the immutable plan and tested SHA.
[coverage-result.test.ts:75](https://github.com/mxbaylee/spinel/blob/754e65317744e5ce97ede501935c6586e4875f2a/scripts/ci/coverage-result.test.ts#L75)
supplies wrong digest/source, cancelled classification and missing result, then
requires exit1 and `passed:false`; at `:120`, failure/cancelled/skipped/empty/missing
selected unit evidence cannot pass, while only proven documentation inapplicability
can skip. These existing node:test owners explicitly passed in the same run's
[remaining partition 132380865589](https://github.com/mxbaylee/spinel/actions/runs/43572824567/job/132380865589).
The supplemental [full original log](../review-assets/spn-157-contract-audit/remaining-original.log.gz)
and [original job metadata](../review-assets/spn-157-contract-audit/remaining-job.json)
were fetched read-only, not by rerunning the job. Log lines 393–397 name all five
CLI aggregate controls as passing; lines 838 and 841 name dependency-closure and
aggregate-plan negatives as passing. The node:test summary is 862 passed, zero
failed and two skipped optional SPN-146 ES/CJS wall-clock benchmarks; neither skip
belongs to this audit's controls. Raw log SHA-256 is
`4aae4a2d969c623393a552d7de1e84664d6b0533983449b56ff148fd818bbd65`;
stored gzip SHA-256 is
`529056c85924f24db50d7d16f56c7cd97d187876aba00f35b136301f41633e9e`.
The receipt binds run, attempt, source and tested identity; the immutable full plan
and published archive bind that job's selection. The original failed aggregate
and current successful aggregate retain distinct actual outcomes.

**Disposition and next action:** the ledger is complete under the explicitly
accepted investigation method. The bounded source audit found no demonstrated
current defect requiring repair, and existing native controls cover both original
scenarios and their negative, persistence, authority, deadline and cleanup
obligations. Propose acceptance of this full **L** investigation as bounded
non-recurrence, with historical cause unknown. This is an evidence-led stopping
decision, not proof of repaired historical causality or a probability estimate of
future recurrence. No additional runtime experiment is warranted by an identified
remaining gap.

Prepare normal conditional ticket deletion, dependent-link update, completion
counter and generated index for independent review. A reviewer finding a missing
invariant, unsupported source binding or current counterexample reopens the audit;
assign its smallest existing owner before adding code or an experiment. A future
first failure must retain its exact context and source, then be tested against the
relevant A1–A9 obligation without blanket retry, timeout increase or weaker
assertion. SPN-157's applicable local checks, two independent reviews, current-head
CI gates and actual merge remain pending; SPN-098 keeps its own fresh-head gates.
The old `44f9a536` branch remains preserved until unique work is durably accounted
for during guarded post-merge cleanup.
