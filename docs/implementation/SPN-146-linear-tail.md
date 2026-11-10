# ⚡ SPN-146 linear native tail assembly question

Proposal of November 5, 2026; the checkpoints below record its execution and are dated. **The current state is
the next section**; the intro and the "Final status" table further down describe 2026-11-06/07 and keep their
counts as of those dates. Older sections that say the cause was not proven are superseded where marked.

## 📍 Current state (2026-11-09)

**📖 How to read this file.** Only this section is current. Every section after "Final status" is a dated checkpoint kept as the record of what was tried and decided at that time; where one says a cause was unexplained or a measurement was missing, this section's cause chain and open items replace it. The decisions that govern landing are the PR-size exception (2026-11-05, re-confirmed at +26.7k on 2026-11-10) and the owner decision below (made 2026-11-10: land, option 1).

**🧬 Mutation evidence for the patches.** The pooled-channel patch in `scripts/dependencies/patch-univer-core.ts` was mutated in review round 11 (removing `ref`/`unref`, removing the `cancelled` check, FIFO to LIFO, disabling the `pooledChannel` bypass): every mutant was killed by `patch-univer-core.test.ts`. Its hosted effect is the patch A/B in `docs/implementation/evidence/SPN-146/patch-ab/` (patched less in 14 of 14 comparable pairs). `patch-univer-docs.ts` is outside this mutation evidence: the linear-tail Docs patch is verified by its guard-removal and work-scaling tests in `patch-univer-docs.test.ts`.

**Mutants run against the presence code (rounds 11–13, all killed):** `redrawScheduler.ts` (`wait > 0` to `>= 0`, `last` not updated, pending guard removed, frame/timer cancel removed, `run` without `cancel`) and `Collaborators.tsx` (Doc/Sheet routing inverted, follow interval 0 to 150, theme/disconnect/deactivate `runNow` replaced by `schedule`, either `cancel` on dispose removed). Flipping the sign of `wait` hangs the run instead of failing an assertion. The diff of this branch under `src/server` and `lib/backup` against `origin/main` is empty (`git diff origin/main --stat -- src/server lib/backup`), so the local full-suite failures are not caused by it. A temporary `.spinel-core-module-*` directory exists only while `patch-univer-core.test.ts` runs and is removed in its `finally`; an interrupted run can leave it.

**Double draw.** A pending Sheet `follow` frame survives `redraw.runNow()`, so a theme change and a Sheet scroll in the same frame draw twice. This is accepted: both draws are cheap and idempotent.

**Landing status (owner, chat 2026-11-10):** option 1, land with the hosted-breach criterion recorded as unmet. The ticket file is deleted, SPN-146 is in `completed_since`, and SPN-089's `depends_on` is cleared; SPN-089 now carries the hosted performance gate. The PR size is approved as is (+26.7k).

Describes the branch from commit d890587c on. Later commits changed `web/Collaborators.tsx` and `src/ui/redrawScheduler.ts` (theme redraw at once, Sheet scroll/zoom on the frame path) and added tests and documentation; the Doc-side measurements below predate the Sheet routing change and are unaffected by it, since Docs keep the interval.

**Cause chain, with where each link is measured.** Three Spinel-owned costs were found and fixed; the rest is
Univer's and Chromium's own per-key work.

| Link                                                                                                   | Evidence                                                                                                                                                                                                                        | Status                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Sync `enqueue` re-encoded the whole pending buffer on every edit (quadratic)                           | Hosted `ci-patch-ab-sync`: majors 207 → 41; lowest-layer work-scaling test; `PendingBuffer` differential and work-scaling tests                                                                                                 | Fixed                    |
| Univer `requestImmediateMacroTask` created one `MessageChannel` per call (about 47,000 per run)        | Hosted `ci-patch-ab-channel`, two cycles: large-major time 3,933 → 1,282 ms and 4,288 → 1,214 ms, patched less in 14 of 14 comparable pairs (2 of 16 unmeasured); worst major 250 → 62 ms in cycle 1 and 255 → 46 ms in cycle 2 | Fixed                    |
| Remote-caret presence redrew on every layout event: one canvas range and popup per caret per key       | Stacks: 1,962 `attachPopupToRange` per 2,086 keys; layouts 12,453 → 8,335 and non-old allocation 110.8 → 88.2 KB per key after a 150 ms throttle (local, 2 runs)                                                                | Fixed, hosted pending    |
| Stock Univer Doc allocates about 79 KB of non-old memory per key (bare `contenteditable`: about 13 KB) | `evidence/SPN-146/oilpan-control/summary.json`, 3 runs each                                                                                                                                                                     | Not Spinel's to remove   |
| Spinel Doc residual above stock Univer                                                                 | 88.2 against 79.1 KB per key; the stock page uses the desktop UI, so mobile UI is inside this gap                                                                                                                               | About 9 KB, unattributed |

**Presence redraw exceptions.** A theme change, a disconnect and deactivation redraw immediately instead of waiting
for the interval. With the theme change throttled, the presence e2e (`e2e/presence-prototype.spec.ts:10`) left a
caret label in the old theme and failed 2 of 3 local runs; with the immediate redraw it passed 6 of 6, and the
pre-throttle code passed 5 of 5. A unit test pins it (`syncPresence.test.ts`, theme at once inside the interval).

**Scroll and zoom.** Sheets redraw remote carets on the next frame after a scroll, zoom, resize or transform, so
they do not trail by an interval. A Doc keeps those events inside the interval: typing raises them, and sending
them to the frame path measured 106 KB of non-old allocation per key against 84 KB with the interval (local,
1 and 3 runs, 2,086 keys).

**PR size and evidence storage.** The 29 largest raw per-run `metrics.json` files (1.1 million lines) are gzipped in
[the patch-ab evidence](evidence/SPN-146/patch-ab/README.md#️-raw-per-run-metricsjson-files); the PR is +26.7k insertions (net +26.1k)
and the owner re-confirmed the size exception at this size (chat, 2026-11-10).

**Sheet join and selection updates.** Events that reach `schedule()` (member joins, selection and sheet changes) can trail the previous
draw by up to 150 ms, as Doc events already did. `syncPresence.test.ts` pins that a Sheet member join redraws within one interval.

**Local full-suite run (2026-11-09, macOS).** `vitest run lib src` (JSON report): 3,805 tests, **141 failed** and 11
failed suites (an earlier run of the same command printed 142; the difference is a timing-dependent test). By file:
`maintenance/supervisor` 106, `backup/service` 11, `backup/filesystem` 7, `backup/export-jobs` 4, `backup/transfer` 4,
`maintenance/cold-files` 3, `backup/restore-candidate` 2, `restore-http`, `restore-registry`, `maintenance/cli` and
`sync/transition-ownership` 1 each (sums to 141). By message: 93 "Supervised maintenance requires Linux", 26
"Filesystem backups require Linux", 16 test or fixture timeouts, 2 recovery-verification failures, 1 restore
process-ownership failure, 1 "Transition fixture stopped at startup", and 2 assertion failures in the cold-file
fixtures (sums to 141). The branch changes nothing under `src/server`; the
assertion failures are in `src/server` files this branch does not touch, so they are not caused by it; they were not each traced to the Linux requirement.
The 9 KB per key residual is left as is: no action is taken in SPN-146, and a stock mobile-UI page to split it is unticketed and unscheduled: the owner chose option 1 on 2026-11-10, which files no follow-up.

**Diagnostics left in the product tree, and when they go.** `src/ui/nativeDocFlushDiagnostic.ts` (gated by
`VITE_DOC_FLUSH_DIAGNOSTIC=1` in `web/docResponsivenessEvidence.ts`), `scripts/ci/doc-native-runtime/*` and the
`SPN146_AB_V8_FLAGS` hook stay in the product tree after landing (owner decision 2026-11-10 accepted the unmet criterion without moving them): SPN-089 carries the hosted performance gate and revalidates with them, and whoever closes that gate removes them. No in-repo build sets the flag, so they are inert in production.

**Owner decision (made, chat 2026-11-10: accept and land, option 1).** Landing closes a ticket whose headline acceptance, no flush breach under
hosted stress, is recorded as not met. The choices are: accept the three fixes and land with the criterion
recorded here; keep SPN-146 open for the hosted proof; or file a sized follow-up for the criterion, which must
carry SPN-089's performance gate. The owner chose the first.

**What is and is not proven.** The two earlier fixes are proven by hosted A/B on the pause length of each major.
Neither removed every 100 ms breach (cycle 2: patched 1 of 8, 106.1 ms, 79.4 ms of it GC inside the flush), and the
presence fix has no hosted A/B yet, so **the claim that the tail is gone is not made**. The remaining majors are
triggered by memory Univer and Chromium allocate per key in a sustained 36-key/s run, so a hosted breach under
stress can still come from a major that lands inside a flush. Acceptance is therefore stated for the owner
rather than assumed: _met_ for "the Spinel-owned causes of the tail are found and fixed", _not met_ for "no flush
breach under hosted stress", which the owner decided on 2026-11-10 to accept and land as unmet (the ticket file was deleted at landing, not amended). The budgets and acceptance numbers (p95 at most 50 ms, maximum at most 100 ms, zero retries, full workload) are kept in this record.

## 📌 Final status (2026-11-06)

> 🗂️ **Superseded by the current state above where counts differ.** Kept as the dated record.

Updated 2026-11-07 with the throttle sweep, the lowest-layer work-scaling test and the review rounds; the older sections below are the dated record and keep their counts as of their dates.

**Reading guide.** This table and the sections 🧪 work-scaling, ⏱️ wall-clock and the A/B result sections for the throttle runs are the current state. Earlier sections (the fixed-window and retained-profile avenues, the "Plan for attribution", and the per-push passes) are the dated record and keep their counts as of their dates.

Evidence caveats (2026-11-07):

- The saved `summary.md` files of runs 42309178838 to 42353649355 were generated by the summarizer as it was then, whose "over budget" tally counted flush budgets only. Under the current all-budget rule (flush, input p95 200 ms, longest task 500 ms) 8x run 1's patched pair 1 reads `fail` (input p95 205 ms), so patched is 1 of 8 on all budgets there, and previous is 1 of 8. The retained per-run exit codes and first-failure messages for both 8x runs are in each folder's `failures.json`; the raw logs were not retained.
- The four 4x runs used the spec's default throttle (4x). Runs 42309178838 and 42320780806 predate the recorded throttle field, so their metrics carry no throttle value; the label-to-throttle step came later.
- The workflow ends a cycle after four consecutive runs with no metrics (all timing out) so an unusable cycle stops early; the summarizer then reports the missing pairs as harness problems.

| Question                                    | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Where                                                                                                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the head meet the mobile flush budget? | Five first-attempt hosted passes (the fifth on `c4be221c`, [run 42309178728](#-fifth-hosted-pass-on-c4be221c-the-head-with-the-ab-workflow)); `patch-univer-docs.ts` differs from `c4be221c` by one JSDoc line (a label on the generation list) and its generated bytes are identical; other differences are the opt-in A/B files, the CI-plan exclusion for them, the guard test, the A/B size, docs, and the rebase onto the Node 26.13 `main` (the fifth pass predates that rebase; head `53fad9fe` has all seven gates green in run 42320777184)                                                     | [passes](#-first-attempt-hosted-mobile-result-on-dde23e1), [restructure pass](#-disposition-mitigation-kept-with-its-diagnostics-owner-chat-2026-11-05) |
| Is the cause of the original tail proven?   | Mechanism shown, hosted cause not proven. Lowest-layer test: native work is quadratic in states, superlinear before this patch, linear after. Hosted A/B, by level: 4x previous 1 of 28 flush breaches (108.6 ms), patched 0 of 28 (p = 0.5); 6x 0 of 8 both; 8x previous 1 of 8 (118.1 ms), patched 0 of 8 flush breaches but 2 of 8 runs exited non-zero (input p95 205 ms, timeouts) against 1 of 8 for previous; a second 8x run timed out on all 16 runs (no data); stress cycle (two competing busy loops, 4x): previous 2 of 8 flush breaches, patched 1 of 8 (205.6 ms), no separation (p = 0.5) | [A/B result](#-hosted-patch-ab-opt-in-and-fourth-push-exception-owner-chat-2026-11-06)                                                                  |
| Why is the diagnostic tooling still here?   | Operator needs it to investigate a recurrence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | [disposition](#-disposition-mitigation-kept-with-its-diagnostics-owner-chat-2026-11-05)                                                                 |
| Exceptions on record                        | PR size (owner); five one-time push exceptions to date below the 95 bar (the fifth covers the rebased head `53fad9fe`; the pushes after it were pending the owner's yes as of 2026-11-06; the owner has since decided, see Current state); no merge-below-95 exception                                                                                                                                                                                                                                                                                                                                   | [size](#-pr-size-exception-owner-chat-2026-11-05)                                                                                                       |
| What remains before merge                   | Seven current-head CI gates on the final head and two independent reviews above 95                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `AGENTS.md`, "Review locally before pushing"                                                                                                            |

## 🔎 Concrete source mechanism

The retained segment diagnostic already located repeated forward-tail copies
after Enter. The current candidate balances that qualified tail, but still
normalizes and clones each leaf at multiple tree levels. In the exact pinned
public Core, `ActionIterator.next` slices/normalizes a full insert body and clones
it; `TextX.push` clones its operand and preserves the native action-merging rules.
SPN-121 explicitly documents that even a full slice adds own-undefined metadata;
directly concatenating strings or copying original inserts is therefore unsafe.

The proposed hypothesis is narrower: **inside the already fully qualified
single-Enter branch only**, could its append-contiguous plain tail be assembled
in linear order using each insert's public `ActionIterator.next(1)` exactly once
and `TextX.push`, plus its first offset retain, with precisely the same raw result
as the existing balanced composition? Keep the entire descriptor/admission guard,
head construction, final native JSONX head/tail join, undo, fallback, cache,
publication and timer behavior unchanged. No normalized fields are discarded.
This does not presume full-body normalization is idempotent or preserve aliasing
without proof; those are falsification targets. Prepend/noncontiguous/structural
tails remain outside this prototype. No unsafe persistent cache is introduced.

## 🧪 First bounded falsification, pending independent review

Prepare a scratch prototype from the hash-verified current ES/CJS manager only,
using the existing deterministic manager fixture and exact pinned public Core.
Do not modify any installed package or production source. Reuse the four lossless
retained real pairs at completed544/672/1440/1984, exact pair hash
e7768818642407ee6f559e251f49f9f408fb95e1ba317e1e9d92053134e97fb5.
Exactly 16 flushes maximum: four pairs × two formats × current/prototype.

Require complete raw output/property-presence/publication-order equality,
input/descriptor nonmutation, fixture-owned timers/listeners/cache cleanup and
unchanged original acceptance assertions. Count native JSONX/TextX/iterator/body
slice/deepClone work with the existing measured fixture, preserving source and
input identities. Require a concrete reduction in repeated tail work on every
pair; guard cost is not part of those counters and no wall-clock gain is inferred.
One serial60s/2GiB/normal-pressure process, no app or browser. Stop and retain the
first setup/hash/semantic/ownership/resource failure; no repair-and-rerun of a
completed failed semantic hypothesis. Exact generated script review precedes
execution. No full installs or repeated exhausted runtime experiments.

A pass would only permit a separately reviewed broader counterexample/ownership
matrix, including own-undefined/empty metadata, styles, preservation markers,
normalization idempotence, all eligible tail lengths/Enter positions, unequal
caches and unsupported inputs. It would not admit a production patch or reopen
the rejected candidate's runtime allowance. A failure closes this proposed
linear construction; raw-equality tests are not relaxed. Current≥20%/≥1ms
guard-inclusive qualification, whole unprofiled mobile budgets, original129/114/
131ms failures, causal limits, full semantics, seven gates and visual/native
owners remain unresolved and unchanged.

Operator gets a finite test of a concrete repeated-copy mechanism; Owner and
Collaborator keep exact native metadata/history/content; Link guest keeps access
fences. The complete accepted outcome remains XL. This is scoped to SPN-146,
with SPN-090 the only other authorized ticket, plus the review–repair loop process addition (`docs/run-backlog.md`, `docs/todo/process.md`, `docs/implementation/backlog-workflow.md`, `AGENTS.md`). The loop is included because this ticket's reviews were the case that exposed the gap and the owner asked for it in the same chat. The owner decided to keep it in this PR (chat 2026-11-06) instead of splitting it out.

## ✅ Exact scratch-script checkpoint

Independent plan and generated-script review admitted one bounded first
falsification on script SHA-256
`9d2ca7399d4f1d12c204587ac13b1ba1e9bcc9b103f6b15e1137ba7f1eab2c33`.
Agent judgment, November5: execute only this local question under the existing
serial60s/2GiB/normal-pressure guard. No production or browser work is admitted.

Both manager formats use the same pinned ES Core; CJS Core bytes are verified,
not executed. Same-realm function construction avoids comparing incidental VM
prototype realms. Service sinks retain references so the comparison includes
input/output alias topology, own descriptors and prototype shape, alongside
complete raw publications. Each native phase must reduce composition, iterator,
body-slice and counted allocation work; aggregate reductions cannot hide a phase
regression. Raw proof is bounded to512KiB/member and4MiB total. Setup, attempt,
partial publication, cleanup and receipt failures preserve the first cause.

The independent review caught wrapper setup outside cleanup and incomplete
failed-attempt/publication retention, including a cleanup-only failure. Those
paths were repaired before any probe execution. Original reviews remain retained.
A successful preliminary result could admit broader semantic counterexamples
only; the complete outcome and failed runtime qualification remain unresolved.

## ✅ Retained-pair outcome and broader semantics

November 5, 2026, agent judgment. The first admitted experiment passed all
16 attempted/completed flushes. Its 16 V8 proof members total 1,529,904 bytes;
current/prototype publications and combined input/output graphs match exactly.
Both phases of every pair reduce all four declared work counters. Per-phase
allocations at completed544/672/1440/1984 are respectively
4,043→2,251; 4,155→2,566; 5,380→5,044; and 3,876→1,680. These counts omit guard
cost, other allocation mechanisms and application subscribers. Body duration
643.114ms is accounting, not comparative performance evidence. The outer guard
passed in1,330ms with315,632KiB peak and normal pressure. Independent review B
verified all16 retained proof hashes/decoded graphs without replaying the manager.

The separately reviewed tail-only broader matrix then passed on generated script
`69e642d1a0326a796ad145c54043bd5de1ef3b93f2e1739608ab0bec5a2ed129`.
All16 declared top-level tests passed, with1,862 wrapped flush calls attempted and
completed; direct helper calls and idle-triggered native flushes are additional
coverage, not included in that counter. The matrix retained seven existing test
bodies per manager format: every paragraph position, REPLACE ownership,
unsupported bridges/operand/read order, absent/undefined/empty metadata,
following-retain/old-body variants, keyboard/cache shapes, and native idle/
segment/remote/pre-Undo boundaries. Two additional tests cover lengths4/5/6/7/9,
every Enter position, offsets0/7, both cover modes, unequal caches,0/1/3 native
normalizations, identical/alternating styles, exact descriptor/alias parity,
output mutation isolation and repeated independent calls. Existing raw output,
applied snapshot and valid sequential oracles remain intact. Artificial old-body
shapes retain their explicitly native-composition oracle.

The matrix ran once, with16,049.694ms body time; outer guard passed16,657ms,
400,512KiB peak, normal pressure. Setup review repaired cross-realm prototype
artifacts, actual Core import binding and first-error/partial-publication cleanup
retention before execution. An earlier generator EEXIST refusal preserved an
unrelated prior matrix; no test or semantic counterexample was rerun. Both formats
still execute ES Core. Source8b682819 and its original failed timing acceptance
remain unchanged. No production package or source was edited by either probe.

These passes support a narrow production proposal and a separately isolated
prefix investigation. They do not establish browser speedup, explain the129.1/
114.4/131.2ms failures, satisfy guard-inclusive≥20%/≥1ms component criteria, renew
closed unchanged experiments or complete SPN-146. Final durable proof links and
independent outcome review will accompany the actual candidate in the PR body.

## 🔎 Prospective prefix-only question

The next distinct question keeps the successful tail construction fixed and
changes only the already fully qualified prefix when its length is at least4.
Build a new native TextX accumulator from the first absolute retain and each
insert leaf's `ActionIterator.next(1)`/`TextX.push`, then retain the existing
prefix/Enter JSONX join and final head/tail join in that order. Prefix lengths
below4 keep the exact original null fold. No generic-prefix-only predicate,
persistent cache, changed guard, undo or fallback is admitted by this proposal.

The four retained pairs have Enter indices7/9/23/3, equal in history and
collaboration. Thus completed544/672/1440 are eligible for strict per-phase work
reduction; completed1984 is an ineligible exact-work negative control. Compare
tail-only against tail-plus-prefix, never attribute their combined benefit to
prefix alone. The proposed first 16 flushes remain four pairs × two manager
formats × two variants, with the same raw proof/ownership/cleanup and bounded
execution requirements. Broader boundary/metadata/normalization/fallback checks
must separately pass, including prefix3/4. No prefix prototype has executed at
this checkpoint, and neither proposal nor review is runtime acceptance.

## ✅ Prefix result and production decision

November 5, 2026, agent judgment after independent review B. The isolated prefix
probe passed all 16 flushes on executable
`eb7857629500a4b3dacec76073db2e3ebb71af69892d8903351f4f98d0f4a727`.
Its 16 binary members total 1,529,904 bytes. Raw publications, descriptors and
input/output ownership graphs match. Both phases reduce all four declared work
counters on each eligible pair; the index-3 negative has exactly unchanged work.
Aggregate allocations for completed544/672/1440/1984 are
4,502→3,956; 5,132→4,300; 10,088→6,708; 3,360→3,360. The outer guard passed in
1,236ms, peak323,936KiB, normal pressure. No wall-clock improvement is inferred.

The separately reviewed prefix-only broader matrix passed all 16 groups and
1,862 wrapped flushes on executable
`7ef166e3848b0e12264fc3fec2e594ccb9b5ccd0090a4d79c3d0a363de5cb7ee`.
The outer guard passed in17,563ms, peak411,888KiB, normal pressure. Metadata and
old-body cases use Enter index4 so they reach the changed path. Boundary counters
aggregate the unequal history/collaboration caches; they do not establish a
per-phase benefit for asymmetric eligibility. Direct helper and idle calls are
additional coverage, not included in the wrapped-flush count. Both formats still
execute pinned ES Core; CJS Core identity is checked without claiming execution.

These distinct primitive-copy and semantic results support implementing the
combined construction within the existing full single-Enter predicate. Prefixes
below4 keep their original null fold. Prefix/Enter and final head/tail joins,
undo, fallback, timers, authority and publication order remain native. The
maintained regression suite compares exact raw output, descriptors/alias graphs,
mutation isolation and native semantic oracles, including every Enter position,
normalization, metadata, unsupported shapes and existing installer guards.
All204 Docs tests passed in42,233ms with587,056KiB peak and normal pressure.

The installer accepts the exact prior qualified-range build as an upgrade and
rejects altered prior bytes and the unpublished tail-only intermediate. Complete
new ES/CJS hashes are respectively
`e47c9319b3c85c737add0e7807edbc27aeafcc81b81dd6ad870058e4fe3da093` and
`4ade808be25d9aed4122d1ab254a07802c89065c06cac42f9dec60fe2f2d286f`.
The isolated local dependency directory has486 lock-matching package versions
and7 workspace links bound to this checkout. It was cloned from the qualified
SPN-090 dependency tree and repatched through the guarded installer; this is not
a clean-install/reproducibility claim. The old partial directory was preserved.

Owner and Collaborator retain exact content, metadata and history semantics;
Operator gets a concrete reduction in repeated copying with bounded validation;
Link guest authority fences do not change. The complete outcome remains XL.

## 🔬 One changed-candidate runtime qualification

Following feasible local integration checks and two independent exact-head
reviews, admit one Linux component experiment on the direct transition from
`8b6828196266f1fac6c46e2cc16b16321db72cf7` to the combined production candidate.
This changes the composition algorithm, unlike the closed qualification-scan
and application-window experiments. Their failures remain evidence and their
allowances remain closed. The workflow admits only the first attempt for this
exact predecessor on the ticket branch; later pushes, reruns and manual dispatch
cannot renew it. Do not cancel ordinary CI to manufacture another qualification.

Keep the original constant-guard baseline, four real pairs, both formats and
both orders: exactly32 observations and16 comparisons. Every comparison must
meet both≥20% and≥1ms guard-inclusive improvement. Preserve the pinned Linux
Chromium4× throttle, trace/converter, GC diagnostics, limits, partial evidence and
first-failure behavior. The previous qualified candidate hash is separately
recorded; it does not replace the baseline. No selective favorable samples or
threshold changes are allowed. A failure or incomplete experiment is not a pass.

Even a component pass leaves the complete unprofiled mobile workload, original
129.1/114.4/131.2ms failures and causal limits, p95≤50ms/max≤100ms budgets, full
content/history/peer/access semantics and all seven current-head gates pending.
No further application profiling is authorized by this component checkpoint.
The existing full CI owners continue to assess application acceptance.

The first full local TypeScript check was aborted after5,685ms by the watchdog
when macOS pressure became2 (observed process-tree1,440,736KiB). It produced no
compiler diagnostic and is incomplete, not a passing check. Retain that attempt;
resource-blocked local checks must remain explicit in review/publication evidence.

## 📦 Retained local evidence

The [linear-copy manifest](evidence/SPN-146/linear-copy/manifest.json) records
source bindings and lossless gzip payload byte counts and SHA-256 digests. It
preserves all four exact executables, results, logs, watchdogs,32 binary proof
members and independent B plan/script/outcome reviews, including their limits.
Production validation additionally passed38 runtime/window controls, targeted
lint, full lint/format/dependency checks and the application build (3,932ms,
961,424KiB peak). The build emitted existing chunk-size/dynamic-import warnings.
These checks do not replace the resource-aborted typecheck or hosted acceptance.

## 🛠️ Independent review caught a complete-module binding defect

Candidate `418f8b6f85711731fd322ab81040ed00f35cadcb` was rejected before push:
independent A92/100 and B90/100. Its ES module called `ActionIterator` without
importing it. Region fixtures and the component harness supply all Core exports,
so their semantic checks could not detect this production lexical error. The
application build also did not execute the qualified branch. No hosted validation
or phone was allocated for that rejected candidate.

The repair adds the exact public ES import under the complete upstream hash and
target-count guard. Prior controls retain their exact original imports/hashes;
an otherwise complete candidate missing the binding is rejected by the installer.
New complete-module tests load the actual ES file and execute the full CJS module
with its own native require bindings, then flush eligible prefix3/4/23 caches.
The ES negative removes the import and must fail with the observed ReferenceError.
The repaired ES hash is
`4b30f509d7426d43b5314f7d32422e0ca94830320d441712b6eed142af2b8dd5`;
CJS remains `4ade808be25d9aed4122d1ab254a07802c89065c06cac42f9dec60fe2f2d286f`.

First test setup failed because Node forbids stripping `.ts` inside node_modules
and the test supplied the same cache array twice, unlike native ownership. The
corrected fixture writes a temporary `.ts` beside the repo's dependency directory
and supplies distinct cache arrays. Its focused two-module check then passed.
The first combined run exposed CJS Core's global JSONX type registration replacing
ES TextX's instrumentation target; comparisons became unmeasured, not product
semantic failures. CJS module validation now runs in a bounded child process,
preserving both real CJS bindings and isolated ES primitive counters. No native
threshold/oracle was relaxed. At that checkpoint all 235 selected Docs/runtime tests then passed in
42,316ms, peak661,472KiB, normal pressure. Temporary modules and managers are
disposed, including the failing missing-import control.

The repaired candidate's full TypeScript check passed in3,248ms, peak1,728,080KiB,
normal pressure. This supersedes the earlier resource-blocked local check while
preserving its receipt. New exact-head reviews are required. (Superseded: the single
hosted transition was consumed on this head; see the next result section.)

The [binding-repair manifest](evidence/SPN-146/linear-binding-repair/manifest.json)
preserves both rejected-source reviews, the original test setup and registry
failures, successful module/regression/typecheck/lint/build checks and exact
repaired source bindings. The earlier manifest remains the original record of
the rejected candidate; its passing region tests are not retroactive production
module validation. Fresh complete-build checks passed after the import repair.

## ❌ Linux component qualification result on `97d0b32` — criterion not met

**2026-11-05.** The single admitted transition (`8b68281…` → `97d0b32`, run
[42110760785](https://github.com/mxbaylee/spinel/actions/runs/42110760785), attempt 1, artifact
`spn146-linux-linear-copy-qualification` 13455300311, 2,486,861 bytes, SHA256
`e105d8e249b9acf0a3e60aa06e52a1fda8262715070cd70e4edc4a4a2a988508`) ran and is now
**consumed**; the earlier "remains unconsumed" wording is superseded. Preparation, build,
observation and conversion completed with valid, complete clock and trace evidence. The
conversion step then failed with "Component result does not satisfy preregistered positive
criterion". Analysis disposition: **inconclusive**. No retry, reinterpretation or threshold
change is authorized, and this does not establish or refute the production latency outcome.

The criterion (unchanged) requires every one of 16 matched whole-flush comparisons to fall by
at least 20% and 1 ms. **13 of 16 met it**, with reductions of 28–66% in ES and CJS at 544,
672 and 1,984 completed states. The three misses are all at completed state **1,440**:

| Format | Order           | Prior ms | Candidate ms | Change        |
| ------ | --------------- | -------- | ------------ | ------------- |
| ES     | candidate-prior | 11.0     | 13.7         | −25% (slower) |
| CJS    | prior-candidate | 8.9      | 7.5          | 16%           |
| CJS    | candidate-prior | 12.7     | 12.4         | 2%            |

State 1,440 is also where the recorded `plain-3` failure (114.4 ms) occurred, so the repair is
not shown to help at the state that failed in CI. The ES 1,440 prior-candidate pair did meet
the criterion (65%), which keeps order and measurement noise as open possibilities; nothing here
identifies a cause. Limits are those of the analysis itself: Linux component only, GC spans may
nest, no pause subtraction, no cross-environment pooling and no historical-maximum explanation.
The artifact is retained on GitHub only until its retention expires; the durable record is
[summary.json](evidence/SPN-146/linux-component-42110760785/summary.json) (all 16 comparisons,
per-interval durations, run/artifact identities and the analysis hash) plus this section.

**Reading the three misses against absolute cost.** The run applied the 4× CPU throttle
(acknowledged in `observation.json`). Across all 32 measured intervals the unrepaired build's whole
flush ranged 8.9–44.5 ms and the candidate's 4.8–15.7 ms; at state 1,440 the unrepaired build cost
only 8.9–16.5 ms, leaving little for a 20% reduction to separate from measurement noise (history
6.1 ms in both ES intervals; the collaboration phase differed 7.2 vs 4.9 ms). So the three misses
are consistent with a relative threshold applied to already-small costs; this is a reading, not a
diagnosed cause. It also shows the component's flush costs are about 7–10× below the production
failures they target (129.1 ms at state 672, 114.4 ms at state 1,440): even the unrepaired build
stayed under the 100 ms budget here. This component therefore cannot validate or refute the repair
against those production maxima; only the unchanged native acceptance gate can, or a new
preregistered question that explains the gap (document size, memory/GC state or runtime pauses in
the real 2,086-key workload).

**Redo-only scope.** (Exercised at workload scale by the later hosted run: every candidate sample's
redo outcome passed; see the hosted result below.) The linear path is intentionally gated to `redoState` with more than four
qualified tail states. `undoState` keeps the unchanged native fold by design, not oversight;
the raw-equality tests in `patch-univer-docs.test.ts` cover both states and show undo unchanged.

**One-shot workflows removed.** `doc-native-runtime.yml` (consumed above) and
`doc-native-diagnostic.yml` (pinned to a long-superseded base commit) can no longer fire, so
both and their file-reading assertions are deleted. Their results remain recorded here and in
the earlier sections. The runner, converter and watchdog sources are kept for now because the
next question may reuse them; move or remove them once the ticket's verdict is in.

**Landing bookkeeping is not acceptance (deferred until 2026-11-10, now applied).** The process prepares the landing bookkeeping (ticket
file deleted, `completed_since`, SPN-089's dependency dropped) before grading
([run-backlog step 3](../run-backlog.md#3-get-two-independent-grades)). With the hosted-breach criterion unmet and
the owner decision then unmade, the PR kept `docs/todo/SPN-146.md`, the backlog counter and SPN-089's
`depends_on: [SPN-146]` as on main until that decision (review round 7, 2026-11-09). The
three edits were applied in the merge-preparation commit after the owner chose on 2026-11-10. The earlier text follows.
(Status update: the hosted mobile gate has since passed once on
`dde23e1`; the head's remaining checks are recorded in the hosted result below.)

## ⚖️ Pre-push review grades and owner decision to validate on CI

**2026-11-05.** Four independent read-only reviewers graded two committed heads, each against the
repository rubric (none was given a prior score or target):

| Head      | Reviewer | Score | Main deductions                                                                                                           |
| --------- | -------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| `97d0b32` | A        | 66    | no latency evidence; spent workflows; patcher/docs weight                                                                 |
| `97d0b32` | B        | 86    | no latency evidence; dead workflow; historical variants                                                                   |
| `64f208d` | C        | 52    | ticket closed before acceptance; SPN-089 unblocked (superseded 2026-11-09: dependency retained); no repair or disposition |
| `64f208d` | D        | 66    | no repair or disposition; component numbers unretained; unreachable tooling                                               |

None reached the 95 bar, and no reviewer found a semantic or access-boundary defect in the patch.
The recurring deduction is the ticket's own scope: neither a causal repair nor an evidence-supported
disposition exists, and only the unchanged native acceptance gate can supply either. A pre-push
grade cannot rise above that without the very run it gates.

**Owner decision (chat, 2026-11-05).** The owner authorized pushing the candidate below the 95
bar so the real mobile `doc-responsiveness` gate can run on the head, as a single first-attempt
validation. This is an exception to the review-before-push gate for this push only. It does not
raise any score, does not certify the pending hosted checks, and does not authorize merging.
Merge still requires the unchanged gate to pass on the final head (p95 at most 50 ms and maximum at
most 100 ms, zero retries, full workload) or an evidence-supported disposition, plus two grades
above 95 on the merged head. A failing first attempt is recorded as failed; no unchanged rerun.

**Superseded 2026-11-09 by the deferral paragraph at the top of this section, and the deferral itself ended on 2026-11-10 when the owner chose to land and the bookkeeping was applied.** (Earlier text: bookkeeping stays in the PR, and takes effect only on merge.) Reviewers C and D asked for the ticket file and SPN-089's dependency to stay. They do: this branch
changes nothing in `docs/todo` except `process.md`, and the landing edits waited for the owner's decision (applied 2026-11-10).

## ✅ First-attempt hosted mobile result on `dde23e1`

**2026-11-05.** CI run `42133642819` on `dde23e1` succeeded end to end, including
**Doc responsiveness (mobile)** and **(desktop)**, with no rerun. The mobile job took 38 minutes.
Candidate observations from the retained `doc-responsiveness-mobile` artifact (all budgets
enforced, `attempt` 0):

| Sample                   | Input frame p95 | Longest task | Paired flush maximum |
| ------------------------ | --------------- | ------------ | -------------------- |
| `plain-1`                | 104.3 ms        | 182 ms       | 48.6 ms              |
| `plain-2`                | 104.4 ms        | 215 ms       | 27.7 ms              |
| `plain-3`                | 104.2 ms        | 202 ms       | 75.5 ms              |
| `profile` (not enforced) | 109.4 ms        | 162 ms       | 43.7 ms              |

The artifact records the candidate source as `8fcb0834…`; that is the GitHub PR merge commit of
`dde23e1` into `main` at `2f44231` (parents `2f44231` and `dde23e1`), which is what `pull_request`
CI builds. The tested head is `dde23e1`.

The unchanged baseline source in the same job stalled for 38.7–40.3 s (longest task) on every
sample. All candidate flush maxima are below 100 ms. This is **one attempt**: earlier heads without
the repair passed about two of three times, so a single pass is supporting evidence, not proof that
the intermittent failure is gone. The PR stays a draft until two independent reviews grade the final
head above 95 and every required check is green on that head.

The pre-push waiver above is spent: the validation ran once and passed, and no unchanged rerun was
needed.

**Second owner exception (chat, 2026-11-05).** Two independent reviews of `d0054c4` graded it 67 and 84
(both below 95; neither found a defect in the patch or bookkeeping; the deductions were one hosted
attempt, no diagnosed cause, no CI on the final head, stale docs, and the PR's size and retained
tooling). The owner authorized one more push of the docs-reconciled head so CI runs on it as a second
first-attempt hosted validation. As before, this raises no score and certifies nothing; the unresolved
deductions remain open until the owner decides the disposition and the tooling cleanup. A Docker smoke
check of the unchanged code passed all three plain mobile samples first (flush maxima 11.7–12.3 ms; see
the rehearsal below). That run is a smoke check only.

## ✅ Second hosted attempt on `6ef3b79` (docs-only delta from `dde23e1`)

Run 42142168016. The mobile gate passed on its first attempt for the second time, on a different and
faster runner (the throttled sample input p95 was about 58 ms against about 104 ms before, so this is a
less stressful sample than the first).

| Sample    | Input p95 | Longest task | Paired flush max |
| --------- | --------- | ------------ | ---------------- |
| `plain-1` | 57.5 ms   | 130 ms       | 31.4 ms          |
| `plain-2` | 59.6 ms   | 124 ms       | 37.0 ms          |
| `plain-3` | 57.3 ms   | 122 ms       | 18.8 ms          |
| `profile` | 61.1 ms   | 126 ms       | 32.8 ms          |

Desktop responsiveness, desktop and mobile callback lifetimes, Pull request, Backlog, Lint, Typecheck,
Unit tests and Lib tests passed on the first attempt. `Playwright smoke (supervised-restore)` failed
once in `e2e/supervised-restore.spec.ts` (the catalog-restore test timed out waiting for
`Owner plan in the backup.`), passed on its own retry, and the job counts a flaky pass as a failure, so
the aggregate gate went red. The same job passed on `dde23e1`, the delta is documentation only, and the
test does not touch Doc typing, so it is recorded as an unrelated flake. The owner re-ran the failed
jobs and every job, including the aggregate **Playwright smoke** gate, passed (attempt 4).

The gated metric is the paired flush maximum (18.8–37.0 ms against the 100 ms budget) and the flush p95
(10.4–13.8 ms against 50 ms). The 122–130 ms longest task and the 57–61 ms input p95 above are
whole-browser numbers with their own, looser budgets (input p95 200 ms, longest task 500 ms, both enforced by the spec), and must not be read as the flush budget.

**Third hosted pass on `7af4691`** (run 42170171728, attempt 1, docs-only delta from `6ef3b79`; every job
passed, including both responsiveness gates, comparison file `passed`, timing valid, no failures):

| Sample    | Input p95 | Longest task | Paired flush max | Flush p95 |
| --------- | --------- | ------------ | ---------------- | --------- |
| `plain-1` | 80.2 ms   | 138 ms       | 41.8 ms          | 10.7 ms   |
| `plain-2` | 77.0 ms   | 149 ms       | 18.5 ms          | 10.8 ms   |
| `plain-3` | 74.1 ms   | 146 ms       | 18.5 ms          | 11.0 ms   |
| `profile` | 83.1 ms   | 179 ms       | 19.9 ms          | 14.9 ms   |

The unchanged baseline in the same job stalled for 23.2–24.4 s (longest task) on all four samples. The
runner's input p95 (74–83 ms) sits between the first run's (about 104 ms, from the `dde23e1` run's artifacts as first recorded) and the second's (about 58 ms).
That makes three first-attempt mobile passes on three runners.

**Fourth hosted pass on `9ea505a7`, the first with the restructured `patch-univer-docs.ts`** (run
42246654363, attempt 1 for the mobile gate; comparison file `passed`, timing valid, no failures). The
code is identical to `f0c3e5b`; `9ea505a7` adds only the third push exception below.

| Sample    | Input p95 | Longest task | Paired flush max | Flush p95 |
| --------- | --------- | ------------ | ---------------- | --------- |
| `plain-1` | 93.0 ms   | 154 ms       | 23.0 ms          | 14.0 ms   |
| `plain-2` | 90.4 ms   | 152 ms       | 23.1 ms          | 14.8 ms   |
| `plain-3` | 86.2 ms   | 200 ms       | 29.8 ms          | 15.7 ms   |
| `profile` | 93.9 ms   | 200 ms       | 27.9 ms          | 16.2 ms   |

The unchanged baseline in the same job stalled for 31.0–32.2 s on all four samples. Desktop
responsiveness, Desktop offline and Storybook passed first time. `Playwright smoke (development 2/2)`
reported 74 passed and 1 flaky: `e2e/restore.spec.ts:8` (the Sheet preview restore test) timed out on a
5 s `toBeVisible` check, passed on its retry, and the job counts a flaky pass as a failure. It is a Sheet
test, unrelated to the Docs patch, and the second unrelated smoke flake after supervised-restore. The
owner re-ran the failed jobs (attempt 2) and every job, including the aggregate **Playwright smoke**
gate, passed.

**Pushes.** The head was pushed twice in a row: `1c5631b7` (the restructure and doc fixes) and `9ea505a7`
(the exception paragraph). The runs on `1c5631b7` were cancelled by the workflow's concurrency setting
when the second push arrived, so `9ea505a7` is the head that carries the hosted evidence.

## ✅ Fifth hosted pass on `c4be221c`, the head with the A/B workflow

Main CI run 42309178728, `Doc responsiveness (mobile)` attempt 1 (started 23:44:58Z, finished 00:25:22Z;
success, no rerun). Every job in the run was green when last read except the `Playwright smoke`
aggregate, still queued (all 14 smoke shards are green and `Lib tests` has passed), so the seven-gate
result is pending. `c4be221c` differs from the production head `9ea505a7`
only in the opt-in A/B files and the CI-plan exclusion for them, and later commits change only docs, one
workflow step, the summarizer's missing-directory guard and tests, so this run exercised the same
production code as the current head.

| Sample  | Paired flush max | Capacity flush p95 | Input p95 (frame opportunity) | Longest task max | Baseline stall (same job) |
| ------- | ---------------- | ------------------ | ----------------------------- | ---------------- | ------------------------- |
| profile | 38.5 ms          | 20.8 ms            | 111.1 ms                      | 188 ms           | 41.7 s                    |
| plain-1 | 29.9 ms          | 19.8 ms            | 106.5 ms                      | 184 ms           | 40.0 s                    |
| plain-2 | 33.2 ms          | 20.4 ms            | 103.6 ms                      | 188 ms           | 39.8 s                    |
| plain-3 | 33.1 ms          | 21.0 ms            | 110.3 ms                      | 162 ms           | 39.5 s                    |

The gated values are the paired flush maximum (budget 100 ms) and capacity flush p95 (budget 50 ms); input
p95 (200 ms) and longest task (500 ms) have their own looser budgets that the spec also enforces. The artifact is `doc-responsiveness-mobile`.

**Status after five hosted passes:** five first-attempt mobile passes on four runner speeds, the latest
on the restructured `patch-univer-docs.ts`, and, for the fifth, a run with no rerun (the second pass's run needed one rerun of an unrelated flaky smoke test). **Superseded by [the hosted channel A/B](#-hosted-result-ci-patch-ab-channel-run-42710690905-head-13d450f4) and the later causes found after this paragraph was written (see the sections from "The batch timer lags typing" on).** The cause of the original 102–129 ms tail was not proven at the time (the later hosted A/B is consistent with the
patch but 1 of 28 previous-build pairs at 4x and 1 of 8 at 8x, reported per level), so the hosted evidence is a mitigation disposition; the lowest-layer work-scaling test shows the mechanism, and the hosted cause is not proven. The retained diagnostics (`scripts/ci/doc-native-runtime/*`,
`nativeDocFlushDiagnostic.ts`) stay so a recurrence can be diagnosed. `nativeDocFlushDiagnostic.ts` is live in the hosted
responsiveness evidence; `scripts/ci/doc-native-runtime/*` is a hand-run tool (`SPN146_RUNTIME_OUTPUT`
sets its output directory) that no workflow invokes, retained with its tests until the fix is proven.

## 🧭 Owner rulings after the first two reviews of `c7c96714` (chat 2026-11-07)

Two fresh reviews of `c7c96714` scored 82 and 84, with no defect found in the patch and all related local
tests passing. The owner ruled on the open points:

- **The ticket acceptance is not amended.** The owner does not accept "mitigation, cause unproven" as the
  deliverable and asked why the cause is not proven. The answer: the mechanism is shown (the work counters
  fall in every qualified phase), but the original hosted tail is rare, about 1 in 12 on the previous build at that point (12 pairs; 1 of 28 at 4x after the later runs),
  and did not reproduce in the second run, so 12 pairs cannot separate the builds. The work therefore
  added a hosted throttle sweep (4x, 6x, 8x; results below, never pooled across levels) and a lowest-layer
  work-scaling test that shows the mechanism deterministically.
- **The process changes stay in this PR** (`docs/run-backlog.md`, `docs/todo/process.md`,
  `backlog-workflow.md`, `AGENTS.md`). Splitting them out is declined, again. Reviewers do not deduct for it.
- **The PR size was approved at about 17k lines; the head is now +26.7k insertions (15.0k evidence, 11.7k other) and the owner re-confirmed it on 2026-11-10.** (Earlier wording: the PR size is approved, about 17k lines, mostly retained evidence and diagnostics). Reviewers do not
  deduct for it.
- **The diagnostics move out of the product tree after the fix is proven**, not before.

## ⚖️ Disposition: mitigation kept with its diagnostics (owner, chat 2026-11-05)

The cause of the original 102–129 ms tail is undiagnosed, so the retained tooling stays and is
deliberate, not leftover scaffolding. Weighed across the personas:

- **Operator:** a recurrence on a slow runner can be investigated only if
  `scripts/ci/doc-native-runtime/*` (run by hand) and `nativeDocFlushDiagnostic.ts` (live in the hosted
  evidence) remain. Removing them leaves a
  mitigation nobody can investigate.
- **Owner:** trimming is a code change needing new local validation, a hosted cycle and fresh
  reviews, to answer a size deduction rather than a correctness one.
- **Collaborator and Guest:** the user-visible outcome, mobile Doc typing within the flush budget, is
  proven by five first-attempt hosted passes; trimming would not improve it.

The PR size (about 17.4k changed lines, +16.8k −0.6k at `53fad9fe`; see [the size exception](#-pr-size-exception-owner-chat-2026-11-05) and the PR header for the current count) is accepted for the same reason: the diff is mostly
retained evidence and diagnostics. A root-cause diagnosis, or removal of the diagnostics once the tail
has stayed absent over further runs, was left to a later owner decision; nothing was deleted here, and on 2026-11-10 the diagnostics were kept (see Current state).

## 🔬 What the evidence does and does not attribute

**Shown (same harness, same sample, unchanged workload):**

- The baseline source stalls for 38.7–40.3 s (longest task) on every hosted mobile sample, and 16.8 s in
  the local container; the candidate does not stall (flush maxima 18.8–37.0 ms hosted, 11.3 ms local).
- The patch removes the repeated forward-tail copying it targets: the retained per-phase work counters
  fall in every qualified phase (the figures are in the mechanism and broader-matrix sections above).
  An earlier draft quoted one combined allocation total; it has no retained source and was removed.
- Undo and every unqualified shape take the old fold unchanged, so the improvement is confined to the
  qualified single-Enter append tail.

**Tested and not reproduced (local container A/B, `docs/implementation/evidence/SPN-146/patch-ab/`):** the
same image, sample (`mobile sustained native typing plain-1`) and flags were run with only the installed
Docs build toggled between the previously installed build (`qualifiedRangesPatched`) and this PR's build
(`patched`), in three alternating pairs, with the installed sha256 checked each time.

| Pair | Build    | Flush p95 / max (ms) | Longest task (ms) |
| ---- | -------- | -------------------- | ----------------- |
| 1    | previous | 10.3 / 14.2          | 80                |
| 1    | this PR  | 8.1 / 11.7           | 58                |
| 2    | previous | 8.9 / 11.1           | 67                |
| 2    | this PR  | 7.6 / 11.5           | 54                |
| 3    | previous | 10.0 / 12.0          | 58                |
| 3    | this PR  | 10.8 / 25.8          | 68                |

All six runs met both flush budgets. The previous build showed no flush tail near 100 ms here, and this
PR's build shows no measurable improvement at n=3 (its worst flush, 25.8 ms in pair 3, is noise). This
machine is about 2.3× faster than the hosted runner and the check is one sample, so it neither supports
nor refutes an effect on the hosted tail.

**Not shown:** that the 102–129 ms flush maxima seen on earlier candidate heads came from this
mechanism, or that this patch is what brought them under budget. The baseline stall and the allocation
drop show the repeated copying exists and is removed; the A/B shows the previous build does not
reproduce the hosted tail locally. A hosted run with the same toggle (previous build against this
build on the same runner) was added afterwards and is recorded [below](#-hosted-patch-ab-opt-in-and-fourth-push-exception-owner-chat-2026-11-06):
at that point (12 pairs) it reproduced a 108.6 ms tail once in twelve previous-build pairs and none in twelve patched pairs, which is
consistent with the patch but not statistically separable. The five hosted passes are therefore
evidence that the current head meets the budget, and the A/B is suggestive, not conclusive, evidence of
what fixed it. The disposition stays a
mitigation, and the diagnostics stay so a recurrence can be attributed. Owner, chat 2026-11-07: they move out of the product
tree only after the fix is proven.

## 🚀 Third push exception: hosted run of the restructured patch file (owner, chat 2026-11-06)

Four independent reviews of the restructured head (`f0c3e5b`: 96 and 91; `d1af661`: 88 and 91) found no
code defect and verified, each by running old against new, that every `prepareDocsPatch` output is
byte-identical for ES and CJS. Their remaining deduction is that `patch-univer-docs.ts` has not had a
hosted run, and the review-before-push rule would block the push that provides it. The owner authorized
one push of the final head so CI runs on it. This raises no grade and certifies nothing. The head that
merges is graded again after that run, and all seven current-head gates and two grades above 95 remain
merge requirements.

## 📈 Lowest-layer work-scaling demonstration

`patch-univer-docs.test.ts` ("Enter-tail work grows quadratically in the original, superlinearly before this
patch and linearly after", run for the ES and CJS bundles) measures the native Undo fold's deterministic
operation counts for one flush of 16, 32, 64, 128 and 256 states with one Enter in the middle (the forward tail the
fold must assemble). The counts are operation counts, not timings, so the contract holds on any runner.
Allocations by number of states:

| States | Original (native) | Previous build | Patched | Previous ÷ patched |
| ------ | ----------------- | -------------- | ------- | ------------------ |
| 16     | 7,614             | 4,126          | 2,924   | 1.41               |
| 32     | 25,502            | 9,280          | 5,516   | 1.68               |
| 64     | 91,998            | 20,882         | 10,700  | 1.95               |
| 128    | 347,870           | 46,628         | 21,068  | 2.21               |
| 256    | 1,351,134         | 103,158        | 41,804  | 2.47               |

Per doubling of the states the original grows 3.3–3.8x (quadratic), the previous build about 2.2x
(superlinear) and the patched build 1.9–2.0x (linear); the patched advantage widens with the dose. Clone visits
give the same shape. The test asserts all of this (patched at most 2x per doubling, original above 3x,
previous above 2x, widening gap to the previous build; thresholds are named constants) and exact native output equality at every length. It
carries a negative control: the same assertions are applied to the previous build's own growth (scaled to 90%
so the "patched is cheaper" check passes) and must throw on linearity, so the test is known to fail without this
patch. This is the diagnosed
cost shown at the lowest layer; it is a work count, not a latency, and it does not claim a wall-clock gain on
any device. It uses one Enter per flush, not the many Enters of the 16-paragraph hosted workload, and it
cannot by itself explain how a roughly 1.7x work cut (at 32 states) produces an outlier of 100 ms or more;
that link (allocation and garbage-collection spikes on a slow runner) is a hypothesis the hosted runs neither
confirm nor refute.

### ⏱️ Wall-clock at the same flush shapes (supporting, not asserted)

The work counts do not by themselves say when the saving shows up in time, so the same test file has a
gated benchmark (`SPN146_BENCH=1`, optionally `SPN146_BENCH_STATES` and `SPN146_BENCH_REPS`; never asserted, so it
cannot flake). It times one real native flush through each build in Node 26.12.1 on a Mac (not a mobile device
and not Chromium under throttle), rotating which build runs first. Medians, ES bundle, one Enter, 300 reps (32
states) or 60 reps (64 and 128 states):

| States per flush | Original (native) | Previous build | Patched      | Patched p99 / max (noisy) |
| ---------------- | ----------------- | -------------- | ------------ | ------------------------- |
| 32 (Enter at 4)  | 2.4 ms            | 3.7 ms         | 3.2 ms       | 4.1 ms / 4.2 ms           |
| 32 (Enter at 28) | 2.4 ms            | 1.8 ms         | 1.8 ms       | 3.0 ms / 3.3 ms           |
| 64               | 8.9–9.1 ms        | 7.3–7.5 ms     | 6.2 ms       | 7.0–7.2 ms                |
| 128              | 32.8–33.2 ms      | 15.8–15.9 ms   | 12.7–12.9 ms | 13.6–14.4 ms              |

What this shows, and what it does not:

- **The time saving needs a large flush.** Below roughly 64 states the patched build is not faster than the
  original native path in Node, and with the Enter early in a 32-state flush it is about 0.8 ms slower at the
  median (the added scans cost more than the copies they remove); with the Enter late (28 of 32) it is
  slightly faster. From 64 states up it is faster than both the original and the previous build, by 1.4x at 64
  and 2.6x at 128 against the original (and about 20% against the previous build), with a lower worst case in most runs (p99 and max are
  noisy at 40–300 repetitions on a laptop: single outliers of 2–3x the median appeared in some runs of every build, so the
  tail comparison is not a result). The saving against the previous build is about 16% at 64 states and about 20% at 128.
- **No claim about the hosted 32-state outlier.** The hosted failing flushes were around 32 states, where this
  benchmark shows little or no median saving. The benchmark therefore does not explain the 102–129 ms events
  by a faster fold, and the doc does not claim it. What it supports is a lower and tighter worst case for
  larger flushes, which is the plausible route to fewer outliers when many keys queue behind a slow frame
  (the throttled mobile case). That remains a hypothesis; the hosted evidence is too thin to confirm it.

## 🔬 Hosted patch A/B (opt-in) and fourth push exception (owner, chat 2026-11-06)

The local container A/B could not attribute the tail, and eight reviews of the final heads (78–96, with
only one above 95) kept the same open points. The owner chose to keep working instead of accepting the
mitigation unattributed, so the PR adds an opt-in hosted A/B:
`.github/workflows/patch-ab.yml` with `scripts/ci/patch-ab/` and `scripts/ci/patch-ab.test.ts`.

- **What it runs.** On one GitHub runner, alternating pairs (four in the first run, eight per cycle since,
  with the order swapped on every other pair) of the previously installed Docs build
  (`previous`, the build earlier failing heads used) and this PR's build (`patched`), each rebuilt and run
  on the same `mobile sustained native typing plain-1` sample with the unchanged budgets. The installed
  sha256 is checked for every run, and the table, JSON and raw runs are published as the job summary and a
  7-day artifact.
- **How to start it.** Add the exact label `ci-patch-ab` to a same-repository PR, or dispatch it manually (dispatch works only once the workflow exists on the default branch, so on this PR the
  label is the way).
  It is never a required gate, and it fails only for harness problems (a wrong installed build, missing
  metrics), not for a variant exceeding the budget, because both variants are meant to be observed.
- **CI plan.** The four experiment paths are excluded from the full and performance suites so adding them
  does not widen coverage; their script tests, lint and typecheck still run, and `plan.test.ts` covers the
  exclusion and that look-alike paths stay full.
- **Exception.** The owner authorized one further push, the fourth, so the experiment can run. This
  raises no grade and certifies nothing. The result will be recorded here whichever way it falls, and the
  head that merges is graded again; all seven current-head gates remain merge requirements. The workflow
  and scripts are removable once the question is answered.

**Result (run 42309178838 on `c4be221c`, 2026-11-06, completed, 4 pairs):**

| Variant                         | Pairs passing budget           | Flush p95    | Paired flush max                               | Longest task | Input p95      |
| ------------------------------- | ------------------------------ | ------------ | ---------------------------------------------- | ------------ | -------------- |
| `previous` (sha `110890e889ac`) | 3 of 4 (pair 2 failed, exit 1) | 21.2–25.0 ms | 31.8, 33.3, 40.1 ms, and **108.6 ms** (pair 2) | 184–240 ms   | 100.1–104.0 ms |
| `patched` (sha `4b30f509d742`)  | 4 of 4                         | 18.7–20.8 ms | 28.8–32.2 ms                                   | 172–229 ms   | 100.8–103.9 ms |

- **What it shows.** The previous build produced one flush maximum of 108.6 ms, over the 100 ms budget and
  inside the 102–129 ms range of the original failures, on the same runner, sample and budgets where the
  patched build stayed at or below 32.2 ms in all four pairs. The patched flush p95 was lower than the
  previous one in every pair (by 5.6, 1.0, 2.5 and 4.1 ms). This is the first hosted observation of the original tail
  with the patch toggled, and it points the right way.
- **What it does not show.** Both builds ran in a fixed order (previous first in every pair, so any warm-up or runner-state effect fell on the previous build; the 108.6 ms tail was a previous-build run). One tail in four previous runs against none in four patched runs is not
  statistically separable (Fisher exact, one-sided p = 0.5), and four pairs are far too few to estimate a
  failure rate. The previous build's three other pairs
  (31.8–40.1 ms) overlap the patched range (28.8–32.2 ms). Input p95 (about 100 ms) and the longest task
  (172–240 ms) do not differ and are not the flush budget (their own budgets, 200 and 500 ms, were met). So the patch is **consistent with** causing the improvement,
  and the original failing builds are not shown to have failed for this reason alone.
- **Disposition.** The mitigation stands with an attribution observation, not a proof. The harness behaved
  (installed hashes matched for all eight runs; the table is in the artifact). Treat the next review as
  grading this added evidence, not as a waiver. The workflow and scripts remain removable.

**Second result (run 42320780806 on `53fad9fe`, 2026-11-06, completed, 8 pairs, rebased onto the Node 26.13 `main`):**

| Variant                         | Pairs passing budget | Flush p95  | Paired flush max | Longest task | Input p95     |
| ------------------------------- | -------------------- | ---------- | ---------------- | ------------ | ------------- |
| `previous` (sha `110890e889ac`) | 8 of 8               | 7.5–9.9 ms | 18.5–36.2 ms     | 147–201 ms   | 83.1–94.6 ms  |
| `patched` (sha `4b30f509d742`)  | 8 of 8               | 7.3–9.8 ms | 18.3–43.4 ms     | 138–209 ms   | 85.7–105.5 ms |

- **What it shows.** Neither build exceeded either budget in eight pairs; installed hashes matched
  for all sixteen runs. Counted with the first run at the time, that was 1 of 12 pairs for the previous build and 0 of 12 for
  the patched build; the current per-level counts are in the final-status table.
- **What it does not show.** The original tail did not reproduce, so this run neither supports nor
  contradicts attribution. The patched paired flush maximum was higher than the previous in 4 of 8
  pairs (as much as 43.4 against 36.2 ms), and the flush p95 is about 8 ms on both builds here against
  about 21 ms in the first run: a different runner state or the Node bump moved the whole
  distribution, so numbers are comparable only within a run.
- **Disposition.** Attribution stays "consistent with, not proven": the tail appeared once in twelve
  previous-build pairs and never in twelve patched-build pairs, and it does not occur often enough on
  these runs to separate them without many more pairs (at a rate near 1 in 12, about 24 pairs per
  arm to expect even two events). The mitigation disposition stands; the measurement is recorded as an
  evidence-supported disposition for SPN-089's Verify clause rather than a causal repair.

**Third result (run 42336853126 on `c7c96714`, 2026-11-07, completed, 8 pairs, order swapped every other pair):**

| Variant                         | Pairs passing budget | Flush p95   | Paired flush max | Longest task | Input p95    |
| ------------------------------- | -------------------- | ----------- | ---------------- | ------------ | ------------ |
| `previous` (sha `110890e889ac`) | 8 of 8               | 7.6–10.0 ms | 17.1–43.4 ms     | 138–190 ms   | 85.6–96.4 ms |
| `patched` (sha `4b30f509d742`)  | 8 of 8               | 6.8–8.9 ms  | 17.1–45.0 ms     | 147–190 ms   | 83.8–87.9 ms |

- **What it shows.** Neither build exceeded either budget in eight pairs, and installed hashes matched for
  all sixteen runs. Counted over the three runs at the time, that was 1 of 20 pairs for the previous build and 0 of 20
  for the patched build; the current per-level counts are in the final-status table.
- **What it does not show.** The tail did not reproduce, so this run neither supports nor contradicts
  attribution. The runner was fast again (flush p95 about 8 ms), the same regime as the second run, while
  the one observed tail came from the slower first run (flush p95 about 21 ms). The patched paired flush
  maximum was higher than the previous in 6 of 8 pairs (pairs 2–7; up to 45.0 ms in pair 6, and 44.8 against 17.1 ms in pair 3); both stay far under the
  100 ms budget, and nothing here says the patch is slower.
- **Why more pairs on this runner will not settle it.** Eight clean pairs on each of two fast runner
  states say the tail needs a slower regime than these runners provide. Repeating the same pairs on a fast
  runner cannot expose it. The next experiment therefore raises the load instead: the workflow reads the
  mobile CPU throttle from the label (`ci-patch-ab` 4x as before, `ci-patch-ab-6x`, `ci-patch-ab-8x`;
  the spec reads `SPN146_AB_CPU_THROTTLE`, which required CI never sets). If the tail is the quadratic
  forward-tail fold, the previous build should breach more often as the throttle rises while the patched
  build stays under; that dose response is a causal test, and a result in either direction is recorded.
  Results are never pooled across throttle levels.

**Fourth result (run 42340182231 on `c7c96714`, 2026-11-07, completed, 8 pairs, 4x throttle, order swapped every other pair):**
8 of 8 pairs within budget on both builds, hashes matched on all sixteen runs, flush p95 5–9 ms (fast runner).
Pooled at 4x over four runs the previous build is over budget in 1 of 28 pairs and the patched build in 0 of 28
(one-sided Fisher p = 0.5, unchanged: one event in 56 cannot separate the arms). Descriptively, the previous
build's paired flush maximum was 34–45 ms in 3 of 8 pairs (2, 3, 4) against 12–15 ms in the other five, while the
patched build was 14–15 ms in 6 of 8 (24 and 35 ms in pairs 7 and 8); that is not tested and is not claimed as
evidence. The cause stays unproven by hosted evidence; the throttle dose response (`ci-patch-ab-6x`,
`ci-patch-ab-8x`) was the planned causal test and was run after the push (6x and 8x results below).

**Throttle dose response, 6x (run 42348189799 on `cde5a7b7`, completed, 8 pairs, `ci-patch-ab-6x`; not pooled with the 4x runs):**
Neither build exceeded either budget (previous 0 of 8, patched 0 of 8), and hashes matched on all sixteen runs.
Descriptively, the previous build's flush p95 was higher than the patched build's in 7 of 8 pairs (previous
12.1–16.8 ms, patched 11.0–13.6 ms). That is a post-hoc secondary metric, not a budget, so it is recorded as
an observation (an exact sign test on 7 of 8 gives one-sided p about 0.035, with no correction for having
looked at several metrics) and not as proof. Paired flush maxima were 28–82 ms for the previous build and
28–74 ms for the patched build, both under 100 ms. The 6x load did not produce a breach in either arm, so the
8x run is the next point on the dose response.

**Throttle dose response, 8x (run 42353649355 on `cde5a7b7`, completed, 8 pairs, `ci-patch-ab-8x`; not pooled with 4x or 6x):**
Hashes matched on all sixteen runs. The summary's flush-budget tally reads previous 1 of 8, patched 0 of 8, but
that tally counts only the flush budgets, and the patched build had two other failing runs, so the honest
per-run record is:

| Run              | Exit | What failed                                                                                                            |
| ---------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| previous, pair 3 | 1    | paired flush max 118.1 ms against the 100 ms budget (the tail this ticket targets; flush p95 16.7 ms)                  |
| patched, pair 1  | 1    | input p95 205 ms against the 200 ms budget, and the test hit its 300 s timeout; the flush budgets passed (max 42.6 ms) |
| patched, pair 3  | 1    | `keyboard.press: Test ended` after the test hit its timeout; every recorded budget passed (flush max 76.2 ms)          |

- **What it shows.** The tail reproduced on the previous build at 8x (1 of 8), the first flush-budget breach
  since the single 4x breach (108.6 ms, run 42309178838), and it did so on a runner whose flush p95 was 10–17 ms (comparable to the 6x run, which had no breach, so the dose response across 4x, 6x and 8x is not monotonic). The
  patched build had no flush breach in eight pairs. That is the direction attribution predicts, on one event.
- **What it does not show.** The patched build is not clean at 8x: two of its eight runs failed for other
  reasons (an input p95 miss and two test-timeout runs, one of which also carried that input miss). Those are
  not flush failures and no flush metric is implicated, but at 8x the patched build did not pass the whole
  spec in 2 of 8 runs, against 1 of 8 for the previous build, which failed only on flush. One run each cannot
  separate these; the timeout and input misses are most likely 8x runner load (the previous build's longest tasks
  reached 378 ms and its input p95 up to 168 ms in the same run), not a patched-build defect, but that is a
  reading, not a result. At 8x the whole-spec failure count is therefore previous 1 of 8, patched 2 of 8.
- **Dose response so far.** Flush breaches by throttle (never pooled): 4x previous 1 of 28 (pooled over the four
  4x runs), patched 0 of 28; 6x previous 0 of 8, patched 0 of 8; 8x previous 1 of 8, patched 0 of 8. The
  previous build's flush breaches (1 of 28 pairs at 4x, 1 of 8 at 8x, reported per level) occurred at 4x (on a slow runner state) and at 8x, none at 6x. Two events do
  not establish a dose response, and the cause remains unproven by hosted evidence.

**Second 8x run (run 42390275800 on `cde5a7b7`, completed with a failed conclusion, 8 pairs, `ci-patch-ab-8x`): no usable data.**
All sixteen runs, eight of each build, exited 1 with `keyboard.type: Test ended` (the 300 s test timeout) and
produced no budget results, so the summarizer reported "0 of 8 expected pairs produced metrics" for both builds
and its Summarize step failed by design. Installed hashes matched on every run. Because both builds failed every
run the same way, this is a runner-load limit at 8x, not a build effect, and it is recorded as neither support
for nor evidence against attribution. It is reported next to the first 8x run (same level) but contributes no
pairs to any tally. Together the two 8x runs say that 8x is at the edge of what a hosted runner can complete:
eight of eight pairs measured on one runner (two patched runs exited non-zero, and so did one previous run, on its flush breach) and zero of eight on the
next. 6x completed cleanly on its run and is the highest level that did so; no further throttle level is planned.

## 📏 PR-size exception (owner, chat 2026-11-05)

The owner withdrew the proposed exception to the 95 bar: the review findings are fixed or answered in this
PR and the final head is graded again, not waived. The recorded exception to the merge requirements is
size; the separate one-time push exceptions are recorded in their own sections (the fifth is the last section).

The PR is about 17.4k changed lines (+16.8k −0.6k at `53fad9fe`; the PR header has the exact count, which drifts with every commit), past the 10k soft limit (a checker warning; the
100k hard limit is not reached). The production change is `scripts/dependencies/patch-univer-docs.ts`
(+238/−50 lines, including the restructure into `helperGenerations()`); the rest is tests, retained diagnostics, evidence and docs.
The owner accepts landing it whole instead of splitting it, because splitting would drop the diagnostics
the Operator needs and cost another full review and hosted cycle for no change in behavior.

**Reviews on `7af4691` (78 and 80, no defect found), and where each deduction is answered:**

| Finding                                                   | Answer                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cause undiagnosed (scope, correctness)                    | Local toggling did not reproduce the tail. The hosted A/B (run 42309178838) did: the previous build hit 108.6 ms once in four and the patched build never exceeded 32.2 ms in four, which is consistent with the patch but too small a sample to prove it (see the result above). |
| Few hosted passes, one on a faster runner                 | A third and a fourth first-attempt pass are recorded (runs 42170171728 and 42246654363, the latter on the restructured patch file); runner speed is reported with each.                                                                                                           |
| Candidate longest task 122–130 ms read as a budget breach | The metric this ticket targets is the paired flush maximum (18.8–37.0 ms); the longest task is a whole-browser number with its own looser budget (500 ms), also met.                                                                                                              |
| Ticket described as accepted repair                       | SPN-089 wording corrected to a mitigation.                                                                                                                                                                                                                                        |
| Layered patch helpers                                     | Restructured into `helperGenerations()` with a documented list of generations; installed output compared old against new for every variant (ES and CJS) and pinned by the test hashes; first hosted run on `9ea505a7` (run 42246654363) passed.                                   |

## 🐳 Local container rehearsal (optional, not an acceptance gate)

A Linux container can run the same spec before a push, so a failing change is found in minutes
instead of the 30-plus-minute hosted job. A local pass never replaces the hosted gate, and a local
number is not comparable to a hosted one. Use it as a smoke check.

**Recipe.** Build one image per source tree (candidate: the checked-out head; baseline: the
`ci.yml` baseline commit with the harness files copied over it, as the hosted job does). The
source tree is copied without `node_modules`, `.git` or build output:

```dockerfile
FROM node:26.13.0-bookworm
ARG SRC
WORKDIR /work
COPY ${SRC}/ /work/
RUN npm ci
RUN npx playwright install --with-deps chromium
ENV VITE_SYNC_EVIDENCE=0 VITE_DOC_SELECTION_EVIDENCE=0 VITE_DOC_RESPONSIVENESS_EVIDENCE=1 \
    SPINEL_E2E_PROJECT=doc-responsiveness CI=1
RUN npm run build
```

The spec calls `git`, so the container entry point creates a throwaway repository first. Save this
as an executable script and mount it read-only:

```sh
#!/bin/sh
set -e
cd /work
git init -q
git config user.email a@example.invalid
git config user.name harness
git add -A >/dev/null 2>&1 || true
git commit -q -m container-snapshot
exec npx playwright test --project=doc-responsiveness --grep "$GREP"
```

Run each image with `docker run --rm --cpus=4 --memory=6g --shm-size=2g -e PRESET=mobile
-e SPN108_BASELINE=<1 for baseline, 0 for candidate> -e "GREP=mobile sustained native typing plain-1"
-v <results dir>:/work/test-results -v <script>:/run.sh:ro <image> /run.sh`.
The retained numbers are in
[`evidence/SPN-146/docker-rehearsal/summary.json`](evidence/SPN-146/docker-rehearsal/summary.json).

**What it ran (2026-11-05).** One sample, mobile `plain-1`, on two images built from that recipe
with the CI environment:

| Image                                                                    | Command                                                            | Result                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| baseline source `2c84a18` plus the current harness files, as in `ci.yml` | `SPN108_BASELINE=1`, grep `mobile sustained native typing plain-1` | ran 2.6 min; longest task 16.8 s, input p95 80 ms (the stall reproduces) |
| candidate `dde23e1`                                                      | `SPN108_BASELINE=0`, same grep                                     | passed in 1.3 min; input p95 41.7 ms, paired flush maximum 11.3 ms       |

**How a machine can verify it is able to run this test.** Work through these in order and stop at
the first one that fails; a machine that fails one cannot give a meaningful result.

1. **Container runtime is up.** `docker info` answers and the daemon has memory for Chromium
   (several GiB, plus `--shm-size=2g` for the browser).
2. **The image builds.** `npm ci` and the Playwright browser install complete inside the container.
   If package downloads are refused, the machine's network policy blocks the registry from containers.
   Use an organization-approved mirror or run natively instead; do not bypass the policy.
3. **The spec can start.** The spec shells out to `git`, so the container needs a throwaway
   repository (`git init` and one commit inside `/work`). Without it the test fails before typing with
   `not a git repository`, which is a harness error, not a result.
4. **The baseline reproduces the stall.** Run the baseline image on the same sample. A pass in a few
   minutes with a long task of seconds (not milliseconds) shows this machine exercises the failure
   being repaired. A baseline with no long task means the check cannot detect the defect here; treat
   any candidate pass as uninformative and rely on the hosted gate.
5. **The candidate passes.** The candidate image on the same sample passes with its enforced budgets.
   A failure here is a real signal to fix before pushing; a pass is necessary, not sufficient.

Retain what is run (image source SHA, grep, environment, summary numbers). A local run carries no
weight toward review grades or merge; those remain the hosted gate and the independent reviews.

## 🔁 Review–repair iterations (2026-11-06)

Recorded under the [review–repair loop](../run-backlog.md#-reviewrepair-loop-before-a-validation-push).
Each row is two fresh independent reviews of the committed SHA, given no prior grade. The reviewers
reported no defect in the production patch in any round; the deductions were attribution, hosted
evidence, process scope, stale or inconsistent documentation and volume. Hosted-only and
owner-decision steps stay pending below.

| Reviewed SHA                                                                      | Scores      | Local steps repaired in the next commit                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `6a053a0b`                                                                        | 86, 83      | A/B p95 range, stale attribution wording, `if: always()`, missing-directory guard                                                                                                                                                                                                    |
| `3cd4aba6`                                                                        | 86, 85      | Typos, direction wording, scope wording, final-status table, hub pointer, workflow guard test                                                                                                                                                                                        |
| `5be496ea`                                                                        | 94, 87      | Decision record, per-path plan test, structural workflow test, stale claims and counts                                                                                                                                                                                               |
| `aff91762`                                                                        | 94, 86      | Fifth hosted pass recorded, broken anchors, scope list, push-exception count, keep-in-PR decision                                                                                                                                                                                    |
| `d5b8bebf`                                                                        | 94, 89      | Rerun and job-state wording, size stated once, AGENTS.md ordering and stop rule, this table                                                                                                                                                                                          |
| `9639b78f` (reviewed; docs-only over `53fad9fe`, which has all seven gates green) | 87, 92      | Repaired in `f5f0ad2b`: exception counts, stale 1-of-4 wording, Fisher and sample-size arithmetic, PR size, Node image tag, guard test widened to six cases, hosted A/B summaries committed under `evidence/SPN-146/patch-ab/`, rerun note in `patch-ab.yml`, `process.md` stop rule |
| `f5f0ad2b`                                                                        | 93, pending | Byte-identical claim and stale "four pairs", this table, and the A/B run order (swapped every other pair in `patch-ab.yml`; the first two hosted runs kept previous-first and are labelled so)                                                                                       |

Still pending after the last round, none doable locally: the unproven cause of the original tail (more
hosted A/B pairs, or an accepted mitigation disposition), the seven current-head gates on the final
head, and the owner's call on trimming the retained diagnostics and the A/B harness. Two local
suggestions were not taken: extracting a shared linear-assembly helper or dropping the never-installed
generation in `patch-univer-docs.ts` (both change production bytes and would invalidate the hosted
evidence), and a YAML-parser test for the workflow (no parser is installed; the string checks stay).

## 🧪 Stress A/B: forcing the slow regime (owner, chat 2026-11-07)

Why: the hosted tail appears only when the runner is slow, 1 of 28 at 4x and 1 of 8 at 8x, and a higher
throttle did not reliably raise it (8x run 2 timed out on every run). A slow runner lets keystrokes queue
behind a frame, which is what makes flushes larger, so the experiment makes the runner slow on demand
instead of waiting for it. Label `ci-patch-ab-stress` keeps the 4x throttle and starts busy-loop processes
beside each test run (first cycle: one per CPU; second cycle onward: half the CPUs, rounded up), ends them after it, and records the count in `summary.json` and
`summary.md` ("Competing load"). Never pool it with an unstressed run.

Decision rule, fixed before the run so it cannot be chosen after it:

- If the previous build breaches a flush budget in at least 3 of 8 pairs and the patched build in at most 1,
  the stress cycle separates the builds (one-sided Fisher exact p is about 0.1 at 3 of 8 against 0 of 8, so
  repeat the cycle until the two cycles together reach p below 0.05 or the pattern fails).
- If both builds breach at similar rates, the slow regime itself causes the tail and this patch does not
  address it; the doc then says so and the ticket's cause stays open with that finding.
- If neither breaches, or most runs time out (the cycle stops after four runs with no metrics), the experiment
  is inconclusive and counts as such.

Results:

- **Cycle 1 (run 42448149074, head `c9bb3fe3`, four busy loops on four CPUs): inconclusive, no data.** All 16
  runs (both builds) hit the 300 s test timeout (`keyboard.type: Test ended`) and left only a partial metrics
  file with no summary; the summarizer reported "0 of 8 expected pairs produced metrics" for both builds. One
  loop per CPU is too much load for this workload to finish at all, so it measures nothing about the builds
  (retained in `run-42448149074-stress-8-pairs/`). It also exposed a workflow bug: the early stop counted any
  metrics file as a measured run, and a timed-out run leaves a partial one, so the stop never fired and the
  cycle spent its full 1 h 20 min. The stop now requires a `summary` in the metrics file, and the behavioral
  test's stub writes a partial file for unmeasured runs, so that case is covered.
- **Cycle 2 (run 42476558232, head `91400232`, two busy loops on four CPUs, 4x throttle): usable, and it does
  not separate the builds.** The stress did put the runner into the tail regime: 3 of 16 runs breached the
  100 ms paired flush maximum, against 1 of 124 unstressed hosted pairs (both builds) before.
  Previous breached 2 of 8 pairs (130.4 ms, 130.0 ms); patched breached 1 of 8 (205.6 ms, the largest value in the
  cycle). Non-zero exits: previous 3 of 8 (two budget breaches and a save-status failure, "Connection
  interrupted"), patched 3 of 8 (one breach and two `keyboard.press: Test ended` timeouts). The one-sided Fisher
  p for 2 of 8 against 1 of 8 is 0.5. Flush maximum per pair, previous: 40.1, 48.8, 56.7, 40.3, 53.2, 130.4,
  130.0, 52.2 ms; patched: 56.0, 62.8, 78.7, 23.6, 29.5, 205.6, 42.0, 73.3 ms; the medians are close (about 53
  and 49 ms) and flush p95 is similar (previous 15.7–19.7 ms, patched 12.6–17.2 ms). Evidence:
  `run-42476558232-stress-half-8-pairs/`.

**Decision-rule reading.** The rule asked for previous at least 3 of 8 and patched at most 1. Previous was 2 of
8, so the cycle is not a separation. The second branch applies in spirit: with competing load both builds
produce the tail at similar rates, and the patched build produced the single worst flush. This is the first
hosted evidence made under a load that reliably provokes the tail, and it gives no support to the claim that the
linear-tail patch removes the tail; with 8 pairs per build it also cannot show the patch does harm (p = 0.5
either way). The honest reading is that the quadratic fold is real and is removed at the lowest layer (the
work-scaling test), but the hosted 100 ms-plus flushes under a slow runner are not shown to come from it, and the
benchmark's no-saving-at-32-states result now has matching hosted evidence. The ticket's cause remains open.

## 🚀 Sixth push exception (owner, chat 2026-11-07)

Round 4 graded 88 and 72. Every remaining deduction is hosted-evidence (the unproven hosted cause, the two patched 8x exits) or the owner's ruling not to amend the ticket acceptance, so the loop's stop rule applied. The owner approved a one-time exception to push this head and run CI. It is not a merge-below-95 exception.

## 🚀 Fifth push exception and larger hosted A/B (owner, chat 2026-11-06)

Four exceptions were used before this one (`dde23e1`, `6ef3b79`, `1c5631b7`+`9ea505a7`, `c4be221c`).
After `d5b8bebf` the reviewers (94 and 89) listed only steps that are hosted-only or owner decisions,
so the [loop's stop rule](../run-backlog.md#-reviewrepair-loop-before-a-validation-push) applies.
The owner said to push to CI for the final score and to cycle the `ci-patch-ab` label. This
one-time exception covered the push of the final, rebased head (`53fad9fe`), which was made. The later docs-and-repair commits were pushed separately by the owner. It was requested for two
reasons that only hosted runs can settle: the seven current-head gates on the merging head, and
more A/B pairs to attribute the original tail.

What changed locally first, in the same push:

- **Guard behavior test** in `patch-univer-docs.test.ts` removes one admission guard at a time from
  the generated helper and shows the scenario it must reject then leaves the native fold. It does
  not depend on hash pins. The redo-only key guard and the more-than-four-states guard each change
  behavior alone. The plain-insert tail check and the offset check overlap (the prefix scan also
  walks offsets, and a second Enter's three edits never match an append offset), so each is
  redundant while the other is present; the test proves them as a pair. Production bytes are
  unchanged.
- **A/B size** in `.github/workflows/patch-ab.yml`: 8 pairs per label cycle instead of 4, with the
  job and step timeouts raised to fit. The workflow is opt-in and not a gate.

**Plan for attribution (superseded by the results below).** The original plan assumed a previous-build
failure rate of 5 in 12, which the data did not bear out (1 of 28 previous-build pairs at 4x). More 8-pair cycles
cannot separate the builds at that rate (Fisher p stays near 0.5 with one event), so the causal evidence is
now the lowest-layer work-scaling test, with the hosted sweep as supporting, non-gating evidence.

**Rubric clarification (owner, chat 2026-11-06).** Reviewers do not deduct for CI results at all, so
the "no CI on the final head" and "gates not yet green" deductions in the rows above are void under
the [recorded rule](backlog-workflow.md#reviewers-do-not-deduct-for-ci-results); they remain listed
here as the reviewers wrote them.

## 🔍 Attribution run: profile under stress

Stress cycle 2 showed the tail on both builds, so the next question is where a slow flush spends its time. The workflow label `ci-patch-ab-profile` runs the same half-CPU stress with the spec's CPU-profile sample and retains each run's profile. Reading rule, set before the run: if breaching flushes on the previous build show time inside the Docs `redoState` fold and the patched build's do not, that supports the patch; if both show GC, idle or starved main thread, the hosted tail is not this mechanism.

### Result (run 42500754153, head `ac9ebc22`)

No flush breached the 100 ms budget on either build (previous worst 84.8 ms, patched worst 60.6 ms, no non-zero exits), so this cycle did not reproduce a hosted breach; the profiler overhead and the lighter regime may be why. The three slowest flushes were analysed from the CPU profiles by stitching consecutive samples inside `_spinelObservedFlush`, allowing garbage-collector and program samples between them:

| run             | paired flush | stretch in profile                  | GC inside it | flush JavaScript |
| --------------- | ------------ | ----------------------------------- | ------------ | ---------------- |
| previous pair 1 | 84.8 ms      | 84.2 ms                             | 56.8 ms      | 28.3 ms          |
| previous pair 8 | 60.5 ms      | 56.8 ms                             | 43.4 ms      | 15.5 ms          |
| patched pair 3  | 35.8 ms      | 33.7 ms                             | 20.2 ms      | 14.8 ms          |
| patched pair 5  | 60.6 ms      | not found (longest stretch 21.9 ms) | 0            | 22.8             |

Across all 966 flushes per build the flush JavaScript totals 5165 ms (previous) and 5033 ms (patched), and garbage collection inside flushes 272 ms and 171 ms.

Reading against the rule set beforehand: the slow flushes on the previous build are garbage-collector pauses landing inside an ordinary 15–28 ms flush, not time in the fold, and a patched flush shows the same pattern. At 32 states the patch does not change the flush's JavaScript time. This supports the second branch, that the hosted tail is not this mechanism. Limits: three slow flushes, one patched slow flush (60.6 ms) unexplained by the profile, no breach in this cycle, profiling overhead on every run, and one cycle. The cause of the hosted 102–205 ms flushes is therefore most likely GC pauses under load, still not proven for the unprofiled runs.

## 🧪 GC attribution run

The profile run explained its slow flushes as GC pauses but did not breach, and the profiler may change the regime. The label `ci-patch-ab-gc` keeps the unprofiled `plain-1` sample under the same half-CPU stress and adds a light V8 GC trace (`SPN146_GC_TRACE=1`, categories `v8.gc` and user timing). The spec aligns main-thread GC events to each flush on the page clock through a sync mark, and records per flush the GC time inside it (`gcTrace` in each run's metrics). Rule set beforehand: if, on both builds, every flush over 60 ms has at least half its duration in GC, the tail is GC pressure and not the fold; if the previous build's slow flushes show mostly JavaScript and the patched build's do not, that supports the patch. The helper is covered by a unit test that aligns a synthetic trace and counts nested phases once.

### Result (run 42509105617, head `74b4c499`)

The GC trace aligned in all 16 runs. No flush breached 100 ms on either build (previous worst 36.9 ms, patched worst 88.1 ms) and no run exited non-zero.

| flush  | build    | duration | GC inside it |
| ------ | -------- | -------- | ------------ |
| pair 3 | patched  | 88.1 ms  | 64.5 ms      |
| pair 7 | patched  | 61.9 ms  | 54.3 ms      |
| pair 7 | patched  | 60.1 ms  | 52.3 ms      |
| pair 8 | previous | 36.9 ms  | 33.8 ms      |
| pair 8 | patched  | 36.1 ms  | 29.9 ms      |

Every flush over 35 ms had at least 80% of its time in main-thread GC. The slowest flushes without GC were 24–32 ms, the ordinary flush cost. Over 8 runs per build: previous 231 ms of GC inside 1052 flushes (7072 ms of flush time), patched 364 ms inside 1049 flushes (6580 ms). The three flushes over 60 ms were all on the patched build, in two runs.

Reading against the rule set beforehand: every flush over 60 ms was mostly GC, so the first branch holds: the tail is GC pauses landing inside a flush, not the fold. Together with the profile run (previous 84.8 and 60.5 ms flushes were GC, a patched 35.8 ms flush was GC) neither build escapes it. This run gives no support for the patch removing the tail and a small amount against: patched GC time inside flushes was higher here, but three events in two runs cannot separate the builds, and the profile run showed the opposite split. Still unexplained: why a major GC lands inside a flush (heap growth from retained history or other allocation); no breach was reproduced, so this attributes slow flushes below the budget, not the original 102–205 ms ones.

### Where the major GCs come from (derived from run 42509105617; `gc-summary.json`)

Every GC that landed in a slow flush was a full mark-compact (30–125 ms for the flushes above). Counting them over all 16 runs, regardless of where they fall:

| build    | major GCs                        | median | p90   | max    | 80 ms or longer  | flush share of typing time |
| -------- | -------------------------------- | ------ | ----- | ------ | ---------------- | -------------------------- |
| previous | 196 in 8 runs (about 24 per run) | 45 ms  | 73 ms | 212 ms | 17 (2.1 per run) | 0.48%                      |
| patched  | 190 in 8 runs (about 24 per run) | 43 ms  | 73 ms | 274 ms | 16 (2.0 per run) | 0.49%                      |

The used heap grows by about 24 MB per run (about 40 MB to 65–78 MB) and total size doubles to about 120 MB. A flush is about 0.5% of the typing time, so a 100 ms flush needs one of the roughly two long major GCs per run to land inside it: an expected rate near 1% of runs for each build, the same order as the observed breaches (1 of 124 unstressed pairs; 3 of 16 stressed runs). Both builds have the same major-GC count and length. The patch does not touch that rate, so it cannot remove the tail. The flush is not special either: the same pauses fall into key handling (longest tasks of 200–390 ms in these runs).

What this changes: the open cause of the hosted tail is the major-GC load of this workload (heap growth during typing), not the fold. Reducing the tail would mean cutting the allocation or retention that triggers about 24 major GCs per 170 s of typing. That has not been investigated: no allocation profile has been taken, so which allocations and retained structures drive the growth is unknown.

## 🧬 Allocation attribution run

The next question is what drives about 24 major GCs per run: allocation churn (garbage that fills the young and old generations) or retention (live data that grows the heap from about 40 MB to 65–78 MB). The label `ci-patch-ab-heap` keeps the half-CPU stress and samples V8 allocations over the typing run (`SPN146_HEAP_SAMPLE`, 16 KB interval): odd pairs sample every allocation including collected objects (churn), even pairs only what is still live when sampling stops (retention), each with both builds. Each run's metrics hold the top 30 sites by sampled bytes with their heaviest caller chain, and the raw sampling profile is kept gzipped. Reading rule, set beforehand: a site or script that accounts for at least 30% of the sampled bytes in the churn or retention view is named as the lever; if no site reaches 30%, the growth is diffuse and no single fix exists. The same sites on both builds confirm the patch plays no part. Helper and summary are unit-tested, and sampling was checked against a real Chromium (the `all` mode reported 24.6 MB for a churn loop that left 0.3 MB live, which `live` mode reported).

### Result (run 42515290552, head `87b9df9b`)

Sampling overhead made the runs unusable as an A/B: flush p95 rose from about 12 ms to 20–28 ms, 11 of 16 runs exited non-zero (timeouts and input or long-task budgets) and one run produced no metrics. No flush reached 100 ms (worst 77.2 ms previous, 76.9 ms patched). The runs are kept only for the allocation profiles; 15 of 16 have a profile (4 runs per build and mode, 3 for previous `all`). Derived tables are in `heap-summary.json`; each run's top 30 sites are all that was kept, so shares are lower bounds.

Churn view (`all`, every allocation): about 9.9 GB sampled per run, roughly 58 MB per second of typing, against about 8 MB still live at the end (`live`). The 24 MB of used-heap growth per run is therefore mostly garbage not yet collected, not retained data: the major GCs come from allocation churn.

| share of sampled churn | site (minified)                                    | what it is                                                        |
| ---------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| 12.7%                  | `fz` under `Sz`/`Vz`/`VF` (univer-renderer)        | Docs layout skeleton pass                                         |
| 10.1%                  | `enqueue` under `onMutation` (`nativeCopy`)        | Spinel's pending-mutation queue, called from `syncExecuteCommand` |
| 5.0%                   | `match` (native regex) under `_d` in `_paintGlyph` | glyph drawing                                                     |
| 4.1%                   | `_drawGlyphGroup`                                  | glyph drawing                                                     |
| 3.7% each              | `flatMap`, `_d`; 3.5% `GI`; 3.4% `getCustomRange`  | layout and glyph helpers                                          |

By script, `univer-renderer` accounts for 66% of the churn, `nativeCopy` (Spinel) 12%, `model` 4%. The retained view is small and led by `enqueue` (14.5% patched, 13.5% previous), then `addObject`/anchor creation (7–8%), `deepClone` in `compose` (7.5–8.3%, the Docs history) and `toHexString` (6%).

Reading against the rule set beforehand (a site or script at 30% or more is the lever): no single site reaches 30%; the largest is 12.7%. At script level the Univer renderer reaches 66%, so the churn is mainly Univer's layout and glyph painting on every keystroke, which Spinel does not own, plus one Spinel-owned site (`enqueue`) at about 10% of churn and about 14% of what stays live. The two builds show the same sites in the same order within about 0.5 percentage points, so the patch plays no part in the allocation either. Limits: sampling overhead changes timing; top-30 sites only; minified names resolved by their callers, not by source map; sampled sizes are estimates.

What this adds to the ticket: the hosted tail comes from about 10 GB of allocation churn per run that triggers frequent full GCs, mostly in Univer's render path. Cutting it would mean rendering and laying out less per keystroke (or giving the heap more young-generation room), which is outside the Docs patch and its size.

## 🧪 Young-generation run

The allocation run points at churn: about 10 GB per run, mostly short-lived layout and paint data, which fills the young generation and promotes survivors into the old generation, where full GCs follow. The label `ci-patch-ab-semispace` tests that chain directly: with the half-CPU stress and the GC trace, odd pairs run Chromium with a 64 MB young generation (`SPN146_AB_V8_FLAGS`, `--min-semi-space-size=64 --max-semi-space-size=64`) and even pairs with the default, both builds in each, so the effect is compared inside one run. Even pair 2 and odd pair 1 are not the same runner moment, so only the whole-run totals are read. Rule set beforehand: if the flagged pairs have at least half as many major GCs per run and fewer flushes with 35 ms or more of GC on both builds, the tail is promotion of short-lived churn into the old generation; if the major-GC count does not move, the old generation is growing for another reason. This is a diagnosis, not a fix: Spinel cannot set a user's V8 flags, so a shippable change would have to cut the churn or promotion instead.

### Result (run 42525930367, head `931e2981`)

This run reproduced the hosted tail, with the GC trace attached, so the breaching flushes themselves are measured for the first time. Odd pairs ran with a 64 MB young generation, even pairs with the default; pair 2's previous run produced no metrics (timeout), so the default previous group has 3 runs.

| flush over 100 ms | build    | mode    | duration | GC inside it | GC detail                                                |
| ----------------- | -------- | ------- | -------- | ------------ | -------------------------------------------------------- |
| pair 3            | patched  | flagged | 127.3 ms | 95 ms        | full mark-compact 87 ms, embedder tracing epilogue 53 ms |
| pair 4            | previous | default | 151.0 ms | 117 ms       | sweeping completion 58 ms, incremental marking steps     |
| pair 5            | patched  | flagged | 158.7 ms | 130 ms       | sweeping completion 102 ms                               |

Every flush over 100 ms is 75–82% garbage collection: full mark-compact, marking and the wait for sweeping to finish. The near misses show the same (previous 89.3 ms, 74 ms of it GC; patched 98.1 ms, 88 ms GC; patched 79.3 ms, 72 ms GC). Breach counts: previous 1 of 7 measured pairs, patched 2 of 8, no separation.

| mode, build       | runs | major GCs per run | major GC time per run | GC inside flushes | flush max over 100 ms | worst flush | total heap at end |
| ----------------- | ---- | ----------------- | --------------------- | ----------------- | --------------------- | ----------- | ----------------- |
| default, previous | 3    | 22.7              | 1307 ms               | 273 ms            | 1                     | 151.0 ms    | 124 MB            |
| default, patched  | 4    | 25.3              | 1356 ms               | 330 ms            | 0                     | 98.1 ms     | 123 MB            |
| flagged, previous | 4    | 14.3              | 1015 ms               | 210 ms            | 0                     | 89.3 ms     | 191 MB            |
| flagged, patched  | 4    | 14.3              | 1010 ms               | 324 ms            | 2                     | 158.7 ms    | 191 MB            |

The flag took effect (the total heap rose from about 123 MB to 191 MB). Against the rule set beforehand (flagged pairs with at least half as many major GCs per run and fewer flushes with 35 ms or more of GC): major GCs fell 41% (14.3 against 24.4 per run), short of half, and the tail did not shrink: both flagged breaches are on the flagged side, and each individual major GC was no shorter (longest 175 ms flagged, 159 ms default). The rule's confirmation is therefore not met.

What this establishes: the hosted flush tail of 100 ms and more is, in each breach seen, 75% or more garbage collection inside the flush, on both builds. A larger young generation cuts how often major GCs happen but not how long the long ones are, so it does not remove the breaches. The patch plays no part: it changes neither the GC count nor the breach rate. The remaining lever is allocation churn itself (the Univer layout and paint path and one Spinel-owned queue site), not V8 tuning, which Spinel cannot set in a user's browser anyway. Limits: 15 runs with metrics, three breaches, the GC trace and stress on every run.

## 🧵 Layout runs on the whole document (cause of the churn)

The allocation profile put 66% of the churn in Univer's layout and paint. To find out why it is that large for a 16-paragraph document, a counter was placed at the entry of the layout's glyph-creation function (`fz`, minified, found by its callers in the profile) and of its shaping loop (`Sz`) in a local production build. The real typing text (16 paragraphs, 2,200 characters, the mobile preset, a connected sync server) was typed and the counters read at each paragraph.

| document size when typing | glyphs created per keystroke (main thread) |
| ------------------------- | ------------------------------------------ |
| 0 characters              | 22 to 92 (the current paragraph only)      |
| 700 characters            | about 720 to 790                           |
| 1,400 characters          | about 1,420 to 1,490                       |
| 2,100 characters          | about 2,130 to 2,200                       |

Every keystroke creates a glyph for essentially every character already in the document, so typing is quadratic in document size (about 4.8 MB of allocation per keystroke in the hosted heap run, ten gigabytes per run). Univer 1.1 has an incremental layout that resumes from the edited paragraph, but `DocSkeletonManagerService.supportsIncrementalLayout()` is true only when a layout executor is registered with `DocLayoutExecutorService`; its status starts as `unregistered`. Spinel registers none, so every edit takes `recalculate()`, the full layout. A counter in the incremental entry (`_prepareIncrementalLayoutStart`) confirmed it runs once, at load, and never per keystroke.

Univer ships the executor: `UniverDocsLayoutWorkerPlugin` and `startDocsLayoutWorker` from `@univerjs/docs`, a Worker that does the layout off the main thread and resumes incrementally. With it registered (`VITE_DOC_LAYOUT_WORKER=1`, `web/docPreset.ts` and `web/docLayoutWorker.ts`), the same counters read a flat 22 to 92 glyphs per keystroke from the first character to the last, for every document size, and the real mobile typing sample passes with every budget and integrity check. Unstressed on this Mac (same sample, same machine): frame p50 19.8 against 23.6 ms, p95 27.1 against 33.7 ms, typing wall 46.1 against 55.0 s, paired flush max 7.9 against 8.4 ms. One run each, so this shows the direction, not a size.

This is a cause, not yet a cure for the tail. The label `ci-patch-ab-worker` runs both variants with this PR's Docs patch and the same stress and GC trace, comparing layout on the main thread (`previous`) with the layout Worker (`patched`). Rule set beforehand: if the Worker build has at least half as many major GCs per run and no flush over 100 ms in 8 pairs while the main-thread build keeps its breach rate, the full-document layout churn is the cause of the tail; if major GCs do not fall, the tail has another source. Left to decide afterwards, whichever way it falls: whether the Worker becomes the default (fonts in the Worker, the offline app shell precache, the content security policy for Workers, the phone view) is a product change with its own acceptance.

### Local pre-check of the Worker build (this Mac, not hosted)

Before any hosted run, the same sample ran four times on this Mac with eight busy-loop processes, a 6x CPU throttle and the GC trace on: two pairs, main-thread layout against the layout Worker, order swapped in the second pair. All four runs passed their budgets; no flush reached 100 ms in either build (flush max 12.1 to 13.1 ms), so this Mac cannot say anything about the tail itself.

| build  | pair | typing wall | frame p50 / p95 | long tasks | total blocking | main-thread major GCs (≥5 ms) | longest major GC |
| ------ | ---- | ----------- | --------------- | ---------- | -------------- | ----------------------------- | ---------------- |
| main   | 1    | 82.2 s      | 33.1 / 50.7 ms  | 68         | 295 ms         | 30                            | 46 ms            |
| Worker | 1    | 64.3 s      | 26.5 / 37.4 ms  | 10         | 142 ms         | 25                            | 59 ms            |
| Worker | 2    | 66.1 s      | 26.9 / 38.2 ms  | 6          | 147 ms         | 29                            | 61 ms            |
| main   | 2    | 79.9 s      | 33.3 / 50.6 ms  | 69         | 265 ms         | 28                            | 46 ms            |

The Worker clearly helps the work it takes over: typing is about 20% faster, long tasks fall from about 68 to 6–10 and blocking time roughly halves. It does not change the thing the tail is made of: the number of main-thread major GCs is the same (25–29 against 28–30) and the longest ones are no shorter. So the main thread still allocates enough (painting, the layout results the Worker returns, the sync client) to keep triggering full collections. Against the rule set above this predicts no confirmation (major GCs not halved); the hosted run still decides, because only the hosted runner produces the tail. The Worker is therefore a throughput fix, and the tail needs the remaining main-thread churn cut as well.

### Compatibility check with the Worker on (this Mac)

With `VITE_DOC_LAYOUT_WORKER=1` compiled into the production build (the bundle holds the `new Worker(...)` factory unconditionally), `e2e/doc-mobile.spec.ts`, `e2e/documents.spec.ts` and `e2e/doc-phone-navigation.spec.ts` ran under the `production` project: 14 passed, 3 skipped, 0 failed. That covers the phone view, viewer upgrades, read-only and guest Docs, queued and native composition, rich text with images, and offline recovery. Not yet checked: fonts inside the Worker against a document with non-default fonts, and the offline cache serving the Worker chunk with the network cut after a cold load.

### 🔁 The batch timer lags typing, so every edit re-encoded the whole pending buffer

Correction to the earlier churn table: Spinel's `enqueue` was not about 10% and bounded by the 25 ms batch delay. With the layout Worker on, which removes the Univer relayout, it was the single largest allocation site on the main thread (1.10 GB of 5.70 GB), and the same 1.1 GB with Worker off.

A temporary probe in `SyncClient.enqueue` and `pump` during the plain-1 sample (about 2,090 edits, 6x throttle) showed:

- `pump` ran at 0.9 s, then not again until 52.1 s, after typing ended. The 25 ms timer did not fire while keys kept arriving every 24 ms.
- So `inflight` stayed empty and the buffer grew from 0 to 2,085 groups, 1.0 MB of JSON (each edit about 480 bytes).
- Each `enqueue` ran `encodedBytes([...this.buffer, copied])`: stringify and encode the whole buffer, so about 500 KB on average per edit. 2,086 edits × ~0.5 MB is the 1.1 GB, and the cost grows with the square of the edits queued.

Fix (`lib/sync-client/src/client.ts`): the buffer's JSON size is measured once and then kept incrementally (adding the new group and one comma); any reassignment or `pump` drains resets it. The admission limit is unchanged. A new test fills the buffer to the exact `MAX_PENDING_BYTES` boundary with a payload chosen so one byte of error changes the count; it fails when the comma term is removed. `pump` already stops at the 64 KB wire limit, so it was not quadratic.

Local, same sample, 8 busy loops, 6x throttle, GC trace on, single runs (not hosted):

| build          | typing wall | frame p95 | long tasks | total blocking | major GCs (≥5 ms) | longest major GC |
| -------------- | ----------- | --------- | ---------- | -------------- | ----------------- | ---------------- |
| main, before   | 82.2 s      | 50.7 ms   | 68         | 295 ms         | 30                | 46 ms            |
| main, fix      | 74.9 s      | 41.0 ms   | 11         | 220 ms         | 6                 | 70 ms            |
| Worker, before | 64.3 s      | 37.4 ms   | 10         | 142 ms         | 25                | 59 ms            |
| Worker, fix    | 60.7 s      | 30.3 ms   | 10         | 295 ms         | 6                 | 94 ms            |

Allocation sampling: `enqueue` fell from 1.10 to 0.04 GB (Worker) and 1.11 to 0.00 GB (main); total main-thread churn fell from 5.70 to 4.67 GB (Worker) and 10.11 to 9.03 GB (main). Major GCs fell about fivefold in both layouts, which meets the rule set above (at least halved) locally. The longest major GC did not get shorter, so fewer collections is not yet shorter pauses; and this Mac shows no flush tail either way (flush max 12 to 13 ms), so only a hosted run can say whether the tail goes.

Hosted test (label `ci-patch-ab-sync`, same stress and GC trace as `-worker`, layout on the main thread in both variants, same Docs patch): `previous` applies `scripts/ci/patch-ab/quadratic-enqueue.patch` (the old `enqueue`) for its build only and reverts it before the run; `patched` is this PR's client. Rule fixed before the run: the fix explains the tail if `previous` repeats its breach rate (flush over 100 ms, about 3 of 16 runs in the semispace run) while `patched` has none in 8 pairs, with `patched` major GCs at most half of `previous`. If major GCs fall but flushes over 100 ms remain, the tail has another source and this is a throughput and memory fix only. If neither moves, this was not the tail.

### Worker failure and fonts (this Mac)

- **Worker script missing:** with the layout Worker compiled in and `docLayoutWorker-*.js` removed from `dist/assets`, `e2e/documents.spec.ts` (rich text, embedded images, reload, offline recovery) still passed under the `production` project, so a Worker that fails to load does not stop a Doc from rendering or accepting typing. The phone caret spec was skipped in that run, so the phone view is covered only by the earlier all-green run with the Worker present.
- **Fonts:** the app declares no `@font-face` or `FontFace`; `src/ui/theme.css` uses `system-ui`, so the page and the Worker resolve the same system fonts for measurement. Line breaks were not compared between the two layouts glyph by glyph.
- **Still open:** the offline cache serving the Worker chunk after a cold load with the network cut. A scratch spec with Playwright's offline switch could not test it: a reload while offline showed the "You're offline" page with the Worker on and off alike, so the check belongs to the `offline-upgrade` project (hosted CI, with the Worker enabled). The Worker chunk is in the service worker's precache manifest in both builds, and the page did start the Worker online (`docLayoutWorker-*.js`).
- **Remaining main-thread churn (Worker on):** after the `enqueue` fix the top sites are all Univer painting (`_drawGlyphGroup`, `_paintGlyph`, `draw`, text measurement in `_d`), about 2 GB of 4.7 GB, bounded by the visible page rather than growing with the edits queued. Cutting it would mean patching Univer's paint path; no evidence yet that it matters for the tail.

### 📊 Hosted result: `ci-patch-ab-sync` (run 42644030946, head `88422ea5`)

Evidence: `docs/implementation/evidence/SPN-146/patch-ab/run-42644030946-sync-8-pairs/` (summary, `gc-summary.json` for all 16 runs, `failures.json`, metrics of the three runs discussed). All 16 runs measured; Summarize passed. 4x throttle, two busy loops, GC trace. `previous` = old `enqueue`, `patched` = this PR's; same Docs patch and hash in all 16.

| per run, medians (range) | previous (old `enqueue`) | patched (fix) |
| ------------------------ | ------------------------ | ------------- |
| major GCs (≥5 ms)        | 26 (23–28)               | 5 (3–7)       |
| typing wall              | 221 s                    | 189 s         |
| frame p95                | 168 ms                   | 120 ms        |
| long tasks               | 1,689                    | 1,487         |
| paired flush max, worst  | 72.2 ms                  | 88.1 ms       |
| longest major GC, worst  | 182 ms                   | 354 ms        |

Against the rule set above: major GCs fell about fivefold in every pair (207 against 41 in total; the rule asked for at most half), but **the rule cannot confirm or refute the tail**. Its first condition, that `previous` repeats its breach rate, failed to occur: no flush reached 100 ms in either build (worst 72.2 ms previous, 88.1 ms patched), so there was no tail to remove. The hosted tail is rare (3 of 16 in the semispace run, 0 of 16 here); one 8-pair cycle cannot separate the builds on it.

What the run does show:

- The fix removes about 80% of main-thread major GCs under the hosted stress and lowers frame p95 by about 30%. That is the quadratic buffer, confirmed on the hosted runner and not only on this Mac.
- It did **not** shorten the worst pauses: the longest major GC is longer in `patched` (up to 354 ms against 182 ms), consistent with fewer collections each finding more to do. One `patched` run (pair 3) failed the 500 ms longest-task budget on a 338 ms major GC (exit 1). Two `previous` runs also exited 1 with every recorded budget passing (messages not retained).
- The one `patched` flush near the limit (pair 6, 88.1 ms) was mostly GC (106 ms of GC in its flushes), as in the earlier runs; `previous` pair 6 (72.2 ms) was the same.

So this removes the cause of the churn but not yet the cause of the rare 100 ms flush, and it introduced fewer-but-longer collections. A next experiment would target the long collections: the heap that survives to them (retention, `-heap` with live-only pairs) and whether a larger young generation or an earlier drain of the buffer shortens them.

### 🔬 Why the remaining collections are long (same run, GC phases)

The three longest `patched` events are not marking work. From each run's GC events (`gc-phase-summary.json`, per-run means over eight runs, total ms and count):

| phase                        | previous     | patched     |
| ---------------------------- | ------------ | ----------- |
| scavenges (young generation) | 1,429 / 205  | 1,307 / 199 |
| major GCs                    | 1,294 / 25.9 | 678 / 5.1   |
| `EMBEDDER_TRACING_EPILOGUE`  | 482 / 22.3   | 450 / 5.1   |
| `ENSURE_SWEEPING_COMPLETED`  | 1,047 / 24.0 | 196 / 3.8   |
| `MC_EVACUATE`                | 434 / 25.9   | 86 / 5.1    |

- **Per major GC, the embedder tracing epilogue costs about 4 times more in `patched`** (88 ms against 22 ms): total time barely moved while the count fell fivefold. In the worst `patched` run (pair 3), 261 of a 338 ms major GC was that phase. It is the browser's own heap (DOM wrappers, canvas), not Spinel or Univer JavaScript, and a fixed cost per collection.
- **`ENSURE_SWEEPING_COMPLETED`**, the main thread finishing sweeping that background threads did not, fell with the collection count (1,047 to 196 ms) but still produced 140–168 ms events in `patched` pair 3. Under two busy loops on four CPUs the sweeper threads compete for CPU, which fits the tail appearing only under load and being 75–82% GC.
- **Scavenges did not change** (about 200 and 1.3 s per run in both builds): the young-generation churn that remains is Univer painting, 2 of 4.7 GB.

Reading: the sync fix removed the avoidable major collections; what is left is a per-collection cost of the browser's heap plus young-generation churn from painting. Shortening the rare long pause means allocating less in the paint path or making collections rarer still (fewer, larger young generations were tried and did not shorten the tail), not more sync work. No further Spinel change is indicated by this run; the open lever is Univer's paint allocation (patching Univer's render path), which is a separate decision.

### 🎨 Would patching Univer's paint path help the tail? Evidence says no

Univer's Docs paint (`_drawGlyphGroup`, `_paintGlyph`, `_drawGlyphGroupBackgrounds`) allocates per glyph per frame: several `Vector2` objects, an offset object and, when a paint sink is set, a closure and cloned offsets. One paint per key over about 1,000 visible glyphs on average accounts for the roughly 180 bytes per glyph-draw in the allocation profile. It is bounded by the visible page, not by the number of edits queued.

That garbage dies young, and the hosted run shows young collections are not the tail: of 3,233 scavenges in the 16 runs, the longest was 23.7 ms (previous) and 19.5 ms (patched), p99 14.4 and 11.0 ms, and none reached 50 ms. A 100 ms flush needs a major collection or sweeping debt (previous section), which paint garbage does not trigger. Cutting paint allocation would lower scavenge counts (about 1.3 s per run), not the long pauses, and would mean patching Univer's render path (a second patch beside the Docs patch) for no measured change to the tail. **Decision: do not patch the paint path for SPN-146.**

Still unexplained, and the remaining candidate for what triggers the five major GCs per run: browser-side memory that V8 counts as external (canvas backing stores, DOM wrappers; the embedder tracing phase above) rather than JavaScript heap growth. That has not been measured; the next evidence would be the heap and external-memory series around each major GC, from the existing GC trace plus `performance.memory`/`process` sampling, not another A/B.

## 🔬 What triggers the major GCs (this Mac, sync fix in, Worker off)

One local `plain-1` run (4x throttle, GC trace) with the JS heap polled every 100 ms over CDP
(`Runtime.getHeapUsage`, `Performance.getMetrics`; temporary helper, not kept).

- Five majors in the 55 s typing window, about 10 s apart (13.1, 24.6, 34.4, 44.2, 51.0 s), 47 to 22 ms each.
- Each fired with the JS heap at 69-82 MB used of a plateaued 128 MB total, and freed only 2-20 MB
  (the sawtooth runs between about 57 and 82 MB). DOM nodes (1.4-1.7k) and documents (1) stayed flat.
- **Correction (see the next section):** this reading was wrong. The trigger is V8's _global_ limit, which counts
  non-old memory too; the "canvas backing stores or DOM wrappers" hypothesis is alive.
- Original (superseded) text: the trigger is JS old-generation growth, not external memory. What grows old space between majors is promoted garbage, objects
  that survive two scavenges, not leaked retention (used falls back after each major).
- Limits: one local run, 1 sample, no stress, and no external-memory number (V8 does not expose it over
  CDP). Hosted majors were 4-5x longer, which this run cannot explain; the embedder-tracing cost in those
  collections stays attributed but untested.

### Worker on against off (this Mac, same probe, two runs each)

- Majors per run stay at five either way. Worker on: typing window about 40 s, majors 36-65 ms (first about 65, then
  about 38). Worker off: about 50 s, majors 27-52 ms (first about 52, then about 29).
- So the major count follows total work, not time, and the Worker does not remove them; its majors are about 30%
  longer (more browser-heap tracing is the candidate, untested). Heap total plateaus at 127-132 MB in both.
- Reading: the trigger is the fixed old-space growth limit, hit about every 1/5 of the run. Whatever promotes
  objects into old space is the lever for fewer majors; what lengthens a major on the hosted runner is a separate
  question that local runs cannot reach (hosted majors are 4-5x longer).

### 🔧 Correction: the global limit triggers the majors, not old space (this Mac)

The GC trace's `V8.GCTraceGCNVP` events carry each GC's reason and sizes. One local `plain-1` run, Worker off:

- All 10 majors say "GC in old space requested" via incremental-marking finalize, but old space was 53-62 MB
  against an old-gen limit of 87-140 MB. The **global** consumed size (old plus external/embedder memory) was
  126-176 MB against a global limit of 126-176 MB: the global limit is what was hit.
- Non-old memory (global minus old) climbs from about 35 MB to 70-115 MB between majors and drops back to
  about 35 MB after each. Old space itself barely moves (mean 0.15 MB per scavenge, 2 of 330 scavenges over
  1 MB), so promoted garbage is not the driver.
- Not the sync client's `TextEncoder`: replacing `encodedBytes` with an allocation-free UTF-8 length left the
  majors unchanged (10 -> 9, large ones 6 -> 5, max non-old 114 MB both).
- Still unattributed: what the roughly 4 MB/s of non-old memory is (canvas or image data, Blink wrappers,
  array buffers). Next probe: allocation sites of ArrayBuffer/ImageData/canvas in the paint path, or Chromium's
  `memory-infra` trace category.

### 🎯 Probe: what the non-old memory is, and what lengthens the majors (this Mac, Worker off)

Temporary page-side counters (wrapped globals, not kept) over one `plain-1` typing run:

- **Not buffers or canvas sizing:** 872 KB through `TextEncoder`, 166 KB through `Uint8Array`, no canvas
  `width`/`height` resizes, no `getImageData`, 37 `measureText`. About 2,000 key events.
- **Heavy call counts:** 1.81 M `ctx.fillText` (about 870 per key: the whole page repaints), 69 k `ctx.save` and
  `restore`, 17 k `getBoundingClientRect`, 13 k `requestAnimationFrame`.
- **47,000 `new MessageChannel()` in one run (about 22 per key).** All come from Univer's renderer
  `makeDirtyWithDebounce` (22.4 k via `_makeDirtyMix`, 20.5 k via `setProps`, 4.2 k via a second renderer
  instance). The helper (`Mv` in the built `univer-renderer` chunk) creates a channel per call to schedule
  one macrotask, then closes both ports. Every channel is Blink (Oilpan) objects plus a pipe.
- **Causal test:** a shim that keeps one real `MessageChannel`, queues the callbacks FIFO and honours `close()`
  (same macrotask semantics; plain-1 still passes). Two runs each:

  |                    | Majors | Major pauses (ms)                                | Max non-old |
  | ------------------ | ------ | ------------------------------------------------ | ----------- |
  | Real channels      | 7, 9   | 48, 50, 37 / 50, 28, 29, 26, 24 (the large ones) | 115, 114 MB |
  | One shared channel | 8, 8   | 10, 8, 10 / 11, 9, 8, 10                         | 110, 110 MB |

  Large majors fall from 25-50 ms to about 10 ms, matching the hosted finding that the embedder-tracing phase
  dominates the long collections. The **number** of majors and the non-old peak do not change, so channel
  churn lengthens each major but is not what fills the global limit.

- An earlier crude stub (a `setTimeout` per call) was invalid: it made things worse (29 majors, 375 MB, a
  failing run). Only the faithful shim counts.
- Open: what else fills the roughly 75 MB of non-old memory per cycle (still unattributed); and whether the
  shorter majors remove the hosted 100 ms tail (needs a hosted A/B, `patched` = the shim as a Univer
  renderer patch, which adds a second patched Univer package).

### 🛠️ The fix: one shared MessageChannel in `@univerjs/core` (built, A/B pending)

- `scripts/dependencies/patch-univer-core.ts` now also replaces core's `requestImmediateMacroTask` (the `Mv` helper
  in the renderer chunk) with one lazily created channel and an in-order queue. Same contract: one later macrotask
  per call, FIFO, cancel before it runs means it never runs. In Node the port is referenced only while a task is
  pending. Both bundles are covered; the upstream function is matched byte for byte, so a changed build fails the
  install. `patchCore(source, format, { pooledChannel: false })` restores upstream for the A/B only.
- Tests (`patch-univer-core.test.ts`): both formats carry the pooled function, upstream is restorable, and the
  scheduler constructs exactly one channel and keeps order, cancellation and nested scheduling (popping instead of
  shifting makes it fail).
- Local real-patch A/B on this Mac (not the shim; Worker off, 4x throttle, two pairs, order patched/previous):

  |                             | Majors | Large major pauses (ms)                 |
  | --------------------------- | ------ | --------------------------------------- |
  | previous (channel per call) | 10, 9  | 51, 28, 26, 27, 28 / 49, 27, 29, 28, 28 |
  | patched (shared channel)    | 6, 9   | 12, 11 / 11, 8, 8, 10                   |

  The large pauses fall by about 60-75%; the count of majors is unchanged within noise.

- Hosted A/B: label `ci-patch-ab-channel` (stress load, GC trace; same Docs patch both sides, so the summarizer
  runs in same-build mode; `previous` runs `scripts/ci/patch-ab/core-channel.ts previous`, which reads the
  installed bytes back and fails if the wrong build was written). Decision rule, set before the run: patched's
  large majors (pause over 20 ms) are fewer or shorter than previous's in at least 6 of 8 pairs, and no patched
  run exceeds the 100 ms paired flush budget. A pass supports, but does not prove, that the channel churn drives the
  hosted tail; a fail means it does not.

### ✅ Hosted result: `ci-patch-ab-channel` (run 42710690905, head `13d450f4`)

Half-CPU stress, 4x, GC trace, same Docs patch both sides. The toggle read back the intended core build in every run
(`installed-core.json`: previous `pooled=false`, patched `pooled=true`, hashes equal to the local ones).

- **The tail reproduced on the old helper and not on the fix.** Previous: paired flush max 105.1 ms (pair 5) and
  124.5 ms (pair 7), both exit 1; pair 6 produced no metrics (exit 1). Patched: 8 of 8 measured, flush max
  19.7-30.4 ms, flush p95 9.7-11.1 ms, longest task 107-256 ms, all budgets met, no non-zero exits.
- **Pre-registered rule: passed.** Large majors (pause over 20 ms): patched had less total large-major time in
  7 of 7 pairs that have both sides (pair 6 has no previous metrics), so at least 6 of 8; no patched run
  exceeded 100 ms. Total large-major time over the run: 1,282 ms patched against 3,933 ms previous; worst single
  major 62 ms patched against 250 ms previous (patched 3-7 per run, previous 4-6; the count is not the lever).
- **Why it counts as support, not proof.** The breach tally alone (2 of 7 previous against 0 of 8 patched) is
  not significant (one-sided exact p = 0.2 for two breaches landing in the previous half), and one run is one
  runner state. The mechanism is the strong part: every pair shows the major pauses shrinking about 3-4x, as in
  the local probe, and the pauses that overlapped the breaching flushes were the long ones.
- Summarize failed by design (pair 6 previous unmeasured); the job's other steps passed.
- Evidence: `docs/implementation/evidence/SPN-146/patch-ab/run-42710690905-channel-8-pairs/` (summary, derived
  `gc-summary.json`, metrics of both previous breaches and the worst and a typical patched run).
- Still open: the roughly 75 MB per cycle of non-old memory that triggers each major is unattributed, and a
  second hosted cycle would tighten the tail evidence; neither blocks keeping the patch, which is correct,
  tested and a direct reduction in browser-heap garbage.

## 🧭 Decisions after the channel A/B (agent, owner-delegated; chat 2026-11-09)

- **Cause, as far as the evidence goes.** The hosted tail comes from long major GCs inside flushes. Two avoidable
  sources of main-thread and browser-heap churn were found and fixed in this PR: the sync client re-encoded the
  whole pending buffer on every edit (quadratic; 5x fewer majors on the hosted runner, run 42644030946), and
  Univer core created one `MessageChannel` per scheduled macrotask (about 47,000 per run; the old helper reproduced
  the 105 and 124 ms flushes and the shared channel had none, large-major time 3,933 ms to 1,282 ms, run
  42710690905). This (WITHDRAWN by the second cycle below: the old-vs-new result did not repeat as a breach reduction) answers the owner's "why is the cause not proven" with a reproduced old-vs-new result and a
  causal local test, not only a mechanism count. It stays one hosted cycle and a rare tail (2 of 7 previous
  breaches, p about 0.2 by that count alone), so a second `ci-patch-ab-channel` cycle was run to tighten it; its result is below and it did **not** repeat the clean patched run.
- **The layout Worker is not shipped.** It was a throughput experiment (about 20% faster typing and fewer long
  tasks locally), it does not remove the tail or the majors (its majors were about 30% longer), and its offline
  cold load and phone view were never verified. The experiment code (`web/docLayoutWorker.ts`, the
  `VITE_DOC_LAYOUT_WORKER` toggle in `web/docPreset.ts`) and the `ci-patch-ab-worker` label are removed, so the
  product tree has no dead flag. Its results stay in the Worker sections above, and in the evidence README.
  Revisit as its own ticket if typing throughput matters.
- **Diagnostics stay until a second hosted cycle repeats the channel result** ("after the fix is proven"). The
  hand-run `scripts/ci/doc-native-runtime/*` and the flush diagnostic then move out, as ruled on 2026-11-07.

### ❌ Hosted result: second `ci-patch-ab-channel` cycle (run 42720456662, head `89f09e40`)

Same method and rule as run 42710690905, scored per cycle and not pooled silently. This runner was slower (flush p95
11.4-17.5 ms against 9.4-13.5 ms in cycle 1).

|                                          | Cycle 1 (run 42710690905)              | Cycle 2 (run 42720456662)             | Both     |
| ---------------------------------------- | -------------------------------------- | ------------------------------------- | -------- |
| Previous flush breaches (over 100 ms)    | 2 of 7 (105.1, 124.5 ms), 1 unmeasured | 0 of 7, 1 unmeasured                  | 2 of 14  |
| Patched flush breaches                   | 0 of 8                                 | **1 of 8 (106.1 ms, pair 4, exit 1)** | 1 of 16  |
| Patched flush max, other runs            | 19.7-30.4 ms                           | 29.0-71.9 ms                          |          |
| Large-major time over 20 ms, total       | patched 1,282 ms, previous 3,933 ms    | patched 1,214 ms, previous 4,288 ms   |          |
| Pairs with less large-major time patched | 7 of 7                                 | 7 of 7                                | 14 of 14 |

- **Pre-registered rule: failed in cycle 2.** The first condition passed (7 of 7 comparable pairs, worst single
  major 46 ms patched against 255 ms previous), but a patched run exceeded the 100 ms paired flush budget.
- **What the breach was.** Patched pair 4's 106.1 ms flush held 79.4 ms of GC: several incremental-marking steps
  (24.4, 7.5, 4.4, 2.9 ms ...) and one 37.6 ms mark-compact finalize. Patched pair 3's 71.9 ms flush was 59 ms of
  `V8.GC_HEAP_ENSURE_SWEEPING_COMPLETED` (the main thread finishing sweeping). So collections still land inside
  flushes under stress; the fix shortens each major, it does not remove GC from the flush path.
- **What is and is not shown.** Shown, in 14 of 14 pairs on two runner states: shared channel cuts large-major
  time about 3.5x and the worst major about 4x. Not shown: that it removes the 100 ms tail. Combined breaches are
  2 of 14 previous against 1 of 16 patched, which these runs cannot separate, and the previous build did not
  breach in cycle 2. The claim in the decisions section above that the fix explains the tail is therefore
  **withdrawn to "reduces the GC pauses that make it"**; the tail's cause is not fully closed.
- **Consequence.** The diagnostics stay (the fix is not proven to remove the tail). The remaining GC-in-flush
  sources are incremental-marking steps, mark-compact finalize and sweeping completion under a loaded main
  thread, driven by the unattributed ~75 MB per cycle of non-old memory. Evidence:
  `docs/implementation/evidence/SPN-146/patch-ab/run-42720456662-channel-8-pairs/`.

### 🔎 Probe: the non-old memory is Blink's own (Oilpan) heap; its source is still open (this Mac)

One local `plain-1` run with Chromium's `disabled-by-default-memory-infra` dumps every 1.5 s (light), read for the
typing renderer (the pid of the sync mark):

- **`blink_gc/main/heap` is the growing memory.** It rises from 5.6 MB to about 90 MB in the first 17 s (roughly
  5-6 MB/s) and then holds at 90-96 MB while V8's majors cut the non-old figure back. This makes "non-old memory"
  concrete: it is Oilpan garbage, which V8's unified heap counts toward the global limit, so it triggers the
  majors, and tracing it is the "embedder tracing" cost seen on the hosted runner. (Only the totals were read;
  the `v8`, `partition_alloc` and `malloc` allocators were not tabulated.)
- **Not these (each a local causal test, one or two runs, 4x throttle; majors per run 8-9 and peak non-old about
  110 MB are the baseline):**
  - Redundant canvas state: skipping 1.78 M of 1.79 M `fillStyle` sets changed nothing (majors 6-8, peak 113-183
    MB in two runs, so no reduction).
  - Canvas call volume: no-op `fillText` (8 majors, 113 MB), the path and clip family (8, 113 MB),
    `save`/`restore` (6 majors, 105 MB) and `clearRect`/`drawImage` (10 majors, 82 MB), one run each. The
    `save`/`restore` and `clearRect`/`drawImage` runs moved the peak a little, within what two baseline runs can
    differ by, so I read none as the source.
  - The performance timeline (3 marks, 25 long-animation-frame entries, no event entries), buffers and canvas
    resizing, and `MessageChannel` (it changed pause length, not the trigger).
- **Next, if pursued:** bisect the app, not the API. Type the same sample in a stock Univer Doc (no Spinel
  layers), then add the Spinel layers back one at a time (phone view, selection overlay, sync, evidence hooks),
  and see where the 5-6 MB/s appears. Whatever it is would also shrink the GC left inside flushes after the
  channel fix.

### 🎯 Bisect result: mostly Univer's own per-key cost, plus one Spinel cause (presence redraw) (this Mac)

An earlier version of this section concluded that no Spinel layer contributes. **That was wrong**; it compared peaks
(both runs reach the limit that triggers a major) instead of the allocation rate per key, and it typed 44,800
characters in the control against the Doc's 2,086. Corrected, in the same units for all runs: memory V8 counts beyond
the old generation (the Oilpan heap), summed between collections, per typed key (`nonOldGrowth` in
`e2e/doc-responsiveness-gc-trace.ts`; 2,086 keys, 4x throttle). Data: `evidence/SPN-146/oilpan-control/summary.json`.

| Page                                                                      | KB per key       | Keys per second |
| ------------------------------------------------------------------------- | ---------------- | --------------- |
| Bare `contenteditable` (`scripts/ci/patch-ab/oilpan-control.ts`)          | 13.8, 13.5, 11.1 | 1,040-1,300     |
| Stock Univer Doc, desktop UI (`scripts/ci/patch-ab/stock-univer/type.ts`) | 79.5, 76.5, 81.4 | 36              |
| Spinel Doc, before the presence fix                                       | 108.7, 112.8     | 38              |
| Spinel Doc, after the presence fix                                        | 87.9, 88.5       | 52              |

The idle bare page had 0 GCs, so the growth is driven by typing.

- **Chromium alone costs about 13 KB per key; stock Univer about 79.** The jump is Univer's canvas Doc: per key it
  rewrites the hidden editor, writes four inline styles on its selection container (`_positionInput`: `position`,
  `left`, `top`, `zIndex`, with `offsetParent` and `getBoundingClientRect` reads between them) and runs about four
  layouts. This is stock Univer code and not patched here.
- **Spinel added about 30 KB per key through presence.** `watchPresence` scheduled a redraw on every document layout
  event, and each redraw rebuilt a canvas range and a popup per remote caret (`attachPopupToRange` 1,962 times in a
  2,086-key run; layouts per run 12,453). The redraw is now at most one per 150 ms (the cursor transport's own
  granularity): attaches fell to 5, layouts to 8,335 and allocation to 88.2 KB per key. The scheduler is
  `src/ui/redrawScheduler.ts` with unit tests (a burst of 100 events draws once at the interval). Mutants run against the tests on 2026-11-09: a theme handler
  that throttles instead of redrawing at once fails the theme test; a 100 ms interval fails the burst test. Round 7 (2026-11-09) added tests for
  the trailing-timer length, each of the five Sheet scroll/zoom sources against the Doc interval, and disposal of both
  schedulers; mutants for a full-interval trailing timer, each source routed to the interval, and either `cancel`
  removed on dispose now fail. The presence e2e results (2 of 3 failed before, 6 of 6 and 8 of 8 passed after) are
  local runs on this Mac, not hosted run identities.
- **A residual of about 9 KB per key (88.2 against 79.1) is unattributed.** The stock page uses the desktop UI and
  has no sync, phone view or evidence hooks, so mobile UI and Spinel's layers share this gap.
- **Message volume is not the lever.** Draining the shared channel's queue in one message cut `postMessage` from about
  45,800 to 15 per run and left the major count unchanged (3-5 majors of at least 5 ms in six runs of each variant).
  The coalescing variant was a probe only.
- **Call counts per run** (one probe run, not causal): `getBoundingClientRect` about 16,700, `TextEncoder.encode` about
  13,400, `drawImage` about 2,300, `measureText` 37.
- **Effect on majors, local:** 3-4 majors of at least 5 ms per run after the presence fix against 4-5 before (two
  runs each; not separable at this sample size). The pause-length result is the hosted channel A/B above.
- **Not yet measured:** a hosted A/B of the presence fix, and a stock mobile-UI page to split the 9 KB residual.
  The presence throttle changes how fast a remote caret follows local typing (up to 150 ms of lag while a burst
  continues; the first change after a pause still draws on the next frame).
