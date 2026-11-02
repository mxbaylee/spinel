# SPN-135 refined diagnostic — first attempt, failed idle coverage

This immutable archive retains run 41485461668 attempt 1, job 125414511042,
helper 1d5c97269ffcb82e0baa091f053781f230dee489 and original tested source
dbbe5ccaf085ce20b79068d3596a35dcf2142223 (tree45abc48, equal to24e00a source).
It is diagnostic-only, not latency acceptance or SPN-135 completion.

The one declared desktop profile failed its final assertion requiring an idle
capture. It observed65 policy capacity flushes, no policy idle flush, and empty
pending caches. Exact pre-Undo content, full Undo/Redo and recorded browser-error
checks passed. The test exited1; completed is absent. The retained Linux cwd-based
process inventory was empty before, after and after cleanup; this is explicitly
not a system-wide process absence claim. No replacement browser attempt ran.

artifact.zip is the complete82-file original artifact13161787619, SHA256
b7a87092107494d71196eb753282bde4b692aebc336816bdd09cccc353cae86d. It contains the
11,907,885-byte trace, original metrics/profile/clock data, screenshots/failure
context, exact runtime/overlay identities, source maps and generated assets.
The trace SHA256 is4ae5d2c17ab57ca2dafeb40159c9da5d56364ac64f6d52e6f62df01831a08241.

Offline analysis reconciles65 paired intervals and593 diagnostic phase spans,
including98 instant-form publication events; clock-anchor drift is-0.092ms.
The terminal history/collaboration phases are outside any policy paired interval:
0.599ms at55133.285ms and0.4ms at55134.085ms. The corresponding exact idle cache
was not captured. The raw capture file honestly contains an empty idle list.
CPU profile nodes11128/11145 descend through anonymous callbacks at retained
model-Bg0rlDVK.js zero-based line1 columns35866/35993, the native history and
collaboration timer callbacks. Last completed input54832.5ms, first-empty55134.5ms,
and later Undo65208ms constrain this attribution. ReviewerA independently verified
these facts; final independent assessment is retained in the parent chat/record.
Existing deterministic boundedDocHistory tests already cover timer-first draining
with an empty observation list, and frame-first draining without duplicate history.
This is an observation gap, not proof of incorrect native behavior or the cause of
the historical34.3ms policy-idle failure.

One instrumented32-item capacity observation was33.3ms, overlapping28.992ms of GC
interval union. This concerns that new capacity interval only. Do not subtract GC
from budgets or attribute the historical idle event from this overlap.

All56 local native-equivalence/capture/trace controls passed first attempt.
Preparation review fixed one retention finding before dispatch: persist the first
measured cache after trace completion and before integrity/UndoRedo. Both reviewers
approved helper1d5c972 for the single attempt. Those are preparation approvals,
not ticket grades. The first preparation and revised-preparation logs are retained.

Offline analysis attempts are explicit: the first command used an unsupported
Node flag; the second parser missed instant-form ph=n publication events. Inspection
of the retained trace identified those events; the third offline analysis accounts
for them as quantized instant spans. It does not turn the failed browser diagnostic
into a pass. An initial node --check outside a module package also rejected the
TypeScript type alias; explicit module-TypeScript stdin parsing passed. No browser
execution was repeated for any analyzer correction.

The helpers are archival only. Phase/capture instrumentation can perturb timing.
The original historical failure, raw final-cache gap, unchanged idle/capacity limits
and fresh unprofiled first-attempt desktop/mobile acceptance remain obligations.
