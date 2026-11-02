# SPN-071 finite allocation discriminator

Predeclared 2026-11-02, before executing this experiment. Production PR source
remains 53ad684. This helper branch is not a proposed merge or acceptance run.

The original 165.8 ms and diagnostic unprofiled 113.5 ms mobile flush failures
remain unexplained. The incomplete diagnostic trace attributes about 151.1 ms
of a separate instrumented 197.7 ms flush to GC. It motivates investigating
allocations; it does not authorize a timing waiver or claim a common cause.

Compare the hash-verified original native fold, current balanced patch, and a
prototype that uses native first-pair composition then joins strictly eligible
contiguous single-character insertions. Require identical own-key shapes,
empty structural metadata and either empty style or identical color-only
`ts.cl.rgb` strings. Current public DocInputController derives that color from
the theme; an empty-style-only prototype would miss that path. Never normalize
colors, strip metadata, share publication results or alter groups/timers.
Unexpected native pair representation and any incompatible state fall back for
the complete cache. Existing balanced eligibility remains the outer boundary.

The finite proof covers ES/CJS, lengths 2/3/7/32, zero/nonzero offsets, append
and constant-offset prepend, exact own undefined/empty fields, UTF-16 and
control boundaries, light/dark/nondefault color shapes, mismatches, rich and
structural fallbacks, empty/divergent caches and input/output ownership. Compare
raw publications and applied snapshots against native; use the existing fixture's
independent sequential oracle. Count real TextX/iterator/clone operations and
require meaningful reduction against the current balanced patch, not merely the
original fold. Counts describe those instrumented primitives, not all JavaScript
allocations. A disabled-shortcut negative control must fail the reduction check.

Run once under the shared local serial lock and memory watchdog. Preserve the
first result, including failures. Revise only against concrete evidence; do not
repeat unchanged. Before production changes, establish that actual browser
fixture states meet the guard and independently review semantic evidence. Any
production change still requires fresh normal performance acceptance, all seven
CI gates and both independent grades on the same source commit.

Operator: preserve honest diagnostics and bounded local resource use. Owner and
Collaborator: require exact content/history/selection and live synchronization
semantics. Link guest: preserve permissions and viewer behavior. This experiment
does not change any of those product contracts or approve implementation scope.

## First result and bounded revision

Prototype cbb5b04 failed both ES/CJS work-reduction checks. All 288 raw-parity
matrix cases and fallback/ownership tests passed only because the prototype
fell back: native composition preserves separate len-1 insertion actions, even
when their styles match. No combined len-2 action is produced. The first log
is retained at `/tmp/spn071-review/allocation-proof-first.log` (2.942 seconds,
432 MiB watchdog peak). This is a failed hypothesis, not optimized parity proof.

Native pair/triple inspections show stable per-character bodies and action order
for zero/nonzero append/prepend color-only input. Revised hypothesis: validate
the native pair's two templates match exactly except text, then independently
clone that template for each character in the correct order. Preserve all own
fields, separate len-1 actions and native run partitioning. No concatenation or
metadata normalization. Require explicit activation for each declared eligible
matrix case of length at least three. Include the prototype's deepClone calls
in primitive counts; direct JS object/array allocations remain uncounted.
Independent nonimplementing reviewer B approved this revised finite experiment
only, with no production or acceptance approval.

The revised discriminator passed all eight ES/CJS tests, including 288 exact
matrix cases with explicit activation for lengths >=3, complete fallback counts,
empty/divergent caches and mutation during publication. For the color-only
32-state fixture, clone allocations fell from 8,658 to 2,868 (66.9%) against
the balanced patch; clone visits fell 17,662 to 5,744. This includes candidate
clones but excludes other direct JS allocations. Watchdog: 2.931 s, 449.4 MiB.

Next bounded capture, predeclared before its browser execution: use the existing
Modern mobile responsiveness fixture and its first three paragraphs, native
keyboard input, unthrottled Chromium, one loaded sender and no loaded peer.
Capture at most the first eight 32-state native caches immediately before flush,
with tagged serialization preserving own undefined fields. The helper observer
and test are diagnostic-only; copies invalidate performance timing and are never
proposed as production instrumentation. Replay those captured states through
the native, balanced and prototype managers to check exact parity and actual
guard activation. Structural groups may correctly retain the fallback.
