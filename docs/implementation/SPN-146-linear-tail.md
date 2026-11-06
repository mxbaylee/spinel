# ⚡ SPN-146 linear native tail assembly question

Historical proposal, November 5, 2026; subsequent checkpoints below record its
execution and the changed production candidate. Source8b682819 remains unqualified;
the fixed-window and retained-profile avenues remain closed with their original
failures. This is a distinct lower-layer semantic/work question, not their retry.

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
Exactly16 flushes maximum: four pairs × two formats × current/prototype.

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
with SPN-090 the only other authorized ticket.

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
prefix alone. The proposed first16 flushes remain four pairs × two manager
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
threshold/oracle was relaxed. All235 selected Docs/runtime tests then passed in
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

**Redo-only scope, not yet exercised at workload scale.** The linear path is intentionally gated to `redoState` with more than four
qualified tail states. `undoState` keeps the unchanged native fold by design, not oversight;
the raw-equality tests in `patch-univer-docs.test.ts` cover both states and show undo unchanged.

**One-shot workflows removed.** `doc-native-runtime.yml` (consumed above) and
`doc-native-diagnostic.yml` (pinned to a long-superseded base commit) can no longer fire, so
both and their file-reading assertions are deleted. Their results remain recorded here and in
the earlier sections. The runner, converter and watchdog sources are kept for now because the
next question may reuse them; move or remove them once the ticket's verdict is in.

**Landing bookkeeping is not acceptance.** Deleting the ticket file and dropping the SPN-089
dependency are prepared in this PR as the process requires before grading
([run-backlog step 3](../run-backlog.md#3-get-two-independent-grades)). They take effect only on
merge, which still requires a causal repair or evidence-supported disposition and a green
current-head native acceptance.

## ⚖️ Pre-push review grades and owner decision to validate on CI

**2026-11-05.** Four independent read-only reviewers graded two committed heads, each against the
repository rubric (none was given a prior score or target):

| Head      | Reviewer | Score | Main deductions                                                              |
| --------- | -------- | ----- | ---------------------------------------------------------------------------- |
| `97d0b32` | A        | 66    | no latency evidence; spent workflows; patcher/docs weight                    |
| `97d0b32` | B        | 86    | no latency evidence; dead workflow; historical variants                      |
| `64f208d` | C        | 52    | ticket closed before acceptance; SPN-089 unblocked; no repair or disposition |
| `64f208d` | D        | 66    | no repair or disposition; component numbers unretained; unreachable tooling  |

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

**Bookkeeping stays in the PR, and takes effect only on merge.** Reviewers C and D asked to restore
the ticket file and SPN-089's dependency. Both are deleted/removed here because the PR checker
(required **Pull request** gate) fails a ticket-titled PR that keeps its ticket file or omits its
`completed_since` entry. The PR is a draft and merging is gated by the acceptance above. If the
validation fails, restore `docs/todo/SPN-146.md`, SPN-146's removal from `completed_since` and
SPN-089's `depends_on: [SPN-146]` from `origin/main` before any other work.

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

The unchanged baseline source in the same job stalled for 38.7–40.3 s (longest task) on every
sample. All candidate flush maxima are below 100 ms. This is **one attempt**: earlier heads without
the repair passed about two of three times, so a single pass is supporting evidence, not proof that
the intermittent failure is gone. The PR stays a draft until two independent reviews grade the final
head above 95 and every required check is green on that head.

The pre-push waiver above is spent: the validation ran once and passed, and no unchanged rerun was
needed. Restoring the ticket bookkeeping is therefore not required.

## 🐳 Local container rehearsal (optional, not an acceptance gate)

A Linux container can run the same spec before a push, so a failing change is found in minutes
instead of the 30-plus-minute hosted job. A local pass never replaces the hosted gate, and a local
number is not comparable to a hosted one. Use it as a smoke check.

**What it ran (2026-11-05).** One sample, mobile `plain-1`, on two images built from this repository's
`Dockerfile`-style recipe (Node from `.nvmrc`, `npm ci`, `npx playwright install --with-deps chromium`,
`npm run build`) with the CI environment (`VITE_DOC_RESPONSIVENESS_EVIDENCE=1`,
`SPINEL_E2E_PROJECT=doc-responsiveness`):

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
