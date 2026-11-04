# ⚠️ Independent Firefox failure disposition

Reviewer `/root/spn120_review_b`, independent/nonimplementing, agent review only.
Run 41875200422 attempt 1, job 126732614676, source 597c3182, Firefox 159.0.1,
macOS 26 ARM64. Normal restart, pending edits, exact reconnect content and conflict
copies completed before the storage-deletion failure. Native deletion/browser
code is unchanged from base; imported offline-fixture utilities are unchanged
and do not execute the modified SPN-120 fixture/session/process paths.

Service-worker unregister and shell-cache deletion returned true. Target private
database deletion succeeded. Verification found no registered worker, zero local
storage and no target private database. The actual failing criterion is the
nonempty shell cache `spinel-shell-cbbe0552bc81f918`; the other two database names
are diagnostic context, not failed criteria. Cache deletion completed around
17:25:46.481Z and the same cache was enumerated at .485Z. Concurrent recreation is
a hypothesis; its producer/timing and root cause are not established. This is not
evidence of data loss or proof of a Firefox platform deletion defect.

Separate L prerequisite: identify active cache producers and establish observable
quiescence for native storage-loss preparation. Preserve empty-cache and targeted
database postconditions, original deadlines and first failure. Add a negative
control for recreation after reported deletion; obtain first-attempt full Firefox
proof through missing-copy and offline-advertisement assertions. Do not repeatedly
delete until green or count unexecuted post-loss assertions as passing.

The archive retains every Firefox JSON/log plus one useful physical failure PNG;
other successful/duplicate screenshots remain supplementary in artifact 13346428816.
ZIP SHA-256: 4bf712b694a34d42c66349d57e6e12c4e330a296ebba03bf328621064df07763.
The inspected failure PNG shows only the seeded fixture dashboard, not user data.
Merge approval remains withheld; no unchanged rerun is justified.
