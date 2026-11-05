# 🔎 SPN-146 prospective native leaf ownership question

November 5, 2026, agent judgment. The97d linear-copy component experiment is
complete but failed its fixed criterion (13/16 pass; three misses at1440).
Original failures and consumed runtime/window allowances remain closed. This
record proposes a different lower-layer question; no execution or production
patch is admitted by writing it.

## 🧩 Concrete public-source mechanism

In the exact pinned public Core, `ActionIterator.next(1)` for an insert calls
`getBodySliceForSplitTextXAction(body,0,1,false)`, spreads the slice into a new body,
then deep-clones the rebuilt action. Current97d immediately passes that owned
result to `TextX.push`, which deep-clones the action again before its existing
native merge logic. Both full-body normalization and a detached published result
are necessary; the necessity of **both consecutive clones** is the open question.
`getBodySliceForSplitTextXAction` is a public named Core export, not a private or
Pro API. `TextX.push` has no documented take-ownership option; do not mutate its
private array or bypass its native merge/ownership rules.

Inside the already fully qualified plain single-character prefix/tail only,
consider passing `TextX.push` an action rebuilt with the exact same leaf spread,
length1, and full public body slice, but without the iterator's preceding clone.
Keep the entire descriptor/admission guard, prefix<4 null fold, native prefix/Enter
and final head/tail joins, undo, unsupported fallback, queues and timer behavior.
Do not remove normalization, fields, undefined properties, markers, formatting
or the final ownership clone. No persistent caches or altered budgets.

The direct public slicer might retain input references, alter side effects, or
produce a different alias graph after only one clone. Those are falsification
targets, not assumptions. Scope this first to the four existing lossless real
pairs544/672/1440/1984,32 states per phase, both manager formats and exact public
Core. The current97d construction is the comparator, not the old constant-guard
baseline used for hosted qualification. Attribute only the removed redundant
clone, not previously obtained linear assembly benefits.

## 🧪 Proposed finite semantic/work test (not yet executed)

Prepare and independently review one exact scratch executable before running.
Maximum16 flushes: four pairs × two formats × current/prototype. Use the existing
raw manager fixture and retained inputs; never install or patch a package.
Require exact raw forward/inverse/publication equality, own-property descriptors,
prototype/alias graphs, no input mutation, the raw native-publication oracle and owned
cleanup. Require strictly fewer counted deepClone visits/allocations in each
changed phase; unsupported paths and the tiny-prefix head construction remain
exact (a qualifying tiny-head group's tail still changes). Iterator calls
may decrease, but **direct slicer calls still count as actual body slicing**:
correct the diagnostic accounting for that direct public call rather than claim
normalization disappeared. A lower iterator count alone is not success.

One serial60s/2GiB/normal-pressure process, no browser/converter/device, with
source/import/full-module identities, bounded lossless proofs and first-error/
partial-publication/cleanup receipts. Preserve the first semantic or resource
failure and close this question on failure; no automatic repair-and-rerun of a
completed failed semantic hypothesis. Full module bindings must be verified,
including the ES public export and CJS require binding, after418's masked import
failure. Region injection alone cannot establish a production import.

A successful first test would admit only a separately reviewed broader semantic
matrix: metadata/undefined/empty fields, shared style graphs,0/1/3 prior native
normalizations, mutations/repeated independent calls, prefix3/4, unequal caches,
unsupported/accessor shapes and existing native idle/remote/pre-Undo owners.
Only after that could a concrete production proposal and new explicitly bounded
runtime qualification be considered. No runtime allowance or acceptance waiver
is granted here. The original≥20%/≥1ms comparator rule, causal distinction and
full unprofiled workload/budgets remain unchanged.

Owner/Collaborator require exact content/style/history and ownership; Operator
gets a bounded question about an observed duplicate-copy operation; Link guest
keeps authority fences. The complete outcome remains XL, with no hidden follow-up.
SPN-090 is the only other authorized ticket.

## ✅ Exact first-script review checkpoint

Independent B review admits one run of scratch executable
`67596c25eb1738293945418d0915a47f6ecdd289d1c6d8ffc2f1799544aaefb7`
under the stated external guard. No production package is changed. Both manager
regions execute ES Core; verified CJS source/namespace bindings do not claim
actual CJS Core execution in this probe. Captured pairs supply a raw native
publication/ownership oracle; inherited applied-snapshot helpers are not invoked,
so this test does not supply fresh independent sequential-document acceptance.
Broader semantics and complete-module execution remain separate requirements.
The initial `node --check` setup treated TypeScript as JavaScript and rejected
`import type`; a stripTypeScriptTypes parse then passed without executing the
probe. No failed semantic experiment was rerun.

## ✅ First retained-pair outcome

The first admitted run passed16/16 attempted/completed flushes, with no cleanup
failure. All16 V8 proof members total1,529,904bytes; each current/prototype pair
has identical bytes and recorded descriptor/alias graph fingerprints. Independent
B review checked all16 proof hashes without replaying the manager. Both phases
strictly reduced clone visits, allocations and iterator calls while actual body
slicing and TextX composition counts remained exactly equal. Aggregate allocations
for544/672/1440/1984 were3,956→3,460;4,300→3,804;6,708→6,212;3,360→2,912 in both
manager formats. This isolates removal of a redundant clone; it does not remove
normalization or prove browser speedup. The outer guard passed1,349ms/324,416KiB,
normal pressure;610.7ms body time is accounting, not a comparative measurement.

The next separately reviewed matrix proposal reuses the prior16 top-level groups,
their full native/applied/valid sequential oracles, metadata and unsupported/read
order controls, boundary lengths/offsets/cover modes, unequal caches and0/1/3
normalizations. Compare current97d against the successful single-clone prototype.
Count direct public slices, so actual slicing/composition must stay equal; require
clone/allocation/iterator reductions only when an admitted group changes. Shared
nested style objects and mutation/repeated-call checks at prefix3/4 add12 wrapped
flushes to the prior1,862 (1,874 expected; direct/idle calls remain additional).
At that checkpoint no broader matrix had executed. Production and runtime gates
remain unchanged, and97d's failed criterion remains closed.

## ✅ Broader semantic outcome

Independent B reviewed exact script
`91ab66113e49542397973f3aede26ddf4bd308438a7b5eedaf8b78f667b9321a`
before its sole execution. All16 groups and1,874 attempted/completed wrapped
flushes passed; direct helper/idle cases are additional. No cleanup failure was
recorded. The outer watchdog passed16,286ms/451,712KiB at normal pressure;
15,666.1ms body time is accounting only. The shared nested-style mutation and
repeated-call cases passed for prefixes3/4 in both manager formats.

The custom unequal-cache primitive comparison is aggregate across both phases;
it does not prove each phase's eligibility independently. Both manager regions
still execute ES Core. Actual complete-module ES/CJS execution, missing-slicer
binding negatives, exact historical upgrade/idempotence controls and fresh
source reviews remain necessary for production integration. No package was
installed or patched by either semantic probe, and no runtime experiment was
renewed by these results.

## 🔬 Production proposal and one finite qualification

The candidate installs the exact successful prototype bytes: ES
`d77c290c1ac30aba9dad723e61dd88b9d0a0c867f9c29173dafc989f37234de2`, CJS
`948d12004209a969b98c5a89e030f00167a995fa190278fb67999ef443806103`.
It retains97d as the complete-module linear-prefix upgrade/work control; every
earlier pinned control keeps its exact bytes. Installer rejection still covers
unknown edits and unpublished intermediate builds. Actual complete ES and CJS
modules must execute admitted prefix3/4/23 and reject a missing slicer binding;
the historical97d missing-iterator regression stays tested. CJS Core executes in
its bounded child to avoid changing ES JSONX's global registration.

Only after feasible checks and two independent >95 exact-commit reviews, publish
one97d→reviewed-candidate transition on the ticket branch. The synchronize-only
workflow accepts attempt1 only. Do not publish over unfinished ordinary97d CI,
cancel source CI to sequence this experiment, or renew a consumed allowance.

This is a new duplicate-copy algorithm qualification, not a rerun of97d. Keep
the original constant-guard baseline, all four retained pairs544/672/1440/1984,
both manager formats and both orders:32 observations,16 comparisons, **every
comparison at least20% AND1ms faster**, including complete guard work. The source
delta relative to97d is established by semantic/work controls;97d is an identity
control in the runtime bundle, never a replacement easier baseline. Keep the
same pinned Linux Chromium4× throttle, converter, complete trace, GC reporting,
first-failure preservation and resource/deadline ceilings. No subset of the three
previous misses, automatic retry, forced GC, GC subtraction or threshold change.

Passing this component would still leave full unprofiled2086-key/16-paragraph
mobile acceptance, p95≤50ms/max≤100ms, all history/content/peer/access contracts,
seven current-head gates and the supported causal disposition of historical
129.1/114.4/131.2ms failures. No new application profiling window is admitted.
Any first semantic/resource/criterion failure closes this finite proposal and
must be retained before considering a genuinely different source question.

## ✅ Local integration checkpoint

First production integration verification passed208 Docs tests (including actual
complete ES/CJS modules, missing slicer bindings, the historical missing iterator,
shared styles and atomic97d installer upgrade),42,576ms/636,528KiB. All29 runtime
controls passed312ms/90,272KiB. Full types4,683ms/1,586,720KiB, full
lint/format/dependencies16,840ms/799,520KiB, and application build
1,669ms/1,064,288KiB passed. Each ran under serial60s/2GiB/normal-pressure guards.

The component **bundle preparation only** passed1,351ms/575,984KiB, producing
4,465,395bytes and binding888 modules across15 packages. It ran against the dirty
candidate on97d, so its source field is the predecessor, not a committed candidate
or hosted identity. Source hashes in the retained manifest bind the actual local
files. No browser observation or converter ran. Existing application chunk-size
and mixed static/dynamic import warnings remain warnings, not new failures.

## 🛠️ Review finding: bind the native function when counters are absent

Both independent reviews withheld candidate8872c05c at94/100. Its fixture always
wrapped the public slicer, even without a counter, and the component builder
copies that fixture into the timed bundle. This introduced candidate-only
test-wrapper overhead. Production bytes were correct, but the native timing
boundary was not ready for publication. No8872 runtime experiment was executed.

The repair binds the exact Core export unless an actual slice counter is supplied;
ordinary flush callers likewise omit the counting callback. The nine affected
complete-module, linear-copy, single-clone, installer and hash controls passed
19,595ms/568,352KiB. Full lint passed16,978ms/731,824KiB. Bundle preparation passed
1,591ms/574,992KiB,4,465,453bytes/888modules; its source field names dirty8872,
not a committed source identity. Production bytes remain exactly unchanged.

The repeated full-project typecheck was **resource-aborted** when macOS pressure
became2: first observed violation5,074ms/1,418,960KiB, retained peak1,601,648KiB.
It is not a pass. An overlapping bundle admission was refused at pressure2 before
execution; the later normal-pressure bundle preparation above is its first actual
execution. After pressure returned to normal, the changed fixture root and its
import graph passed the unchanged repository compiler options in311ms; sampled
owned peak90,448KiB does not establish an instantaneous native compiler peak.
Original full-project types passed before this test-only binding repair; current
full-project acceptance remains hosted. No memory/deadline ceiling was relaxed.

The initial51-payload manifest is explicitly bound to8872. A separate binding
repair manifest retains both rejected reviews, the first pressure abort, focused
scope/config, repaired checks and current source bindings. Both reviewers must
regrade the final committed repair before publication; old94 grades do not pass.
