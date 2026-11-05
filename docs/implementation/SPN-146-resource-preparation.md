# 🔬 SPN-146 resource preparation checkpoint

2026-11-05. The df76 one-time diagnostic failed at2,097,368KiB before the384 boundary. It is closed. The source collector successfully retained30scripts/50.6MB. The original violating per-process snapshot was not retained; final reap data cannot assign the contributor. No new application attempt is admitted by this checkpoint.

Small concrete guard repair: retain the first violating resource sample separately from final process reaping, with PID/start/parent/RSS and an executable-role basename only (no arguments). Keep the exact limits, accounting,100ms cadence and signals. Pure controls must prove first failure wins and final reaping cannot replace it.

Proposed source-collection reduction: the current live collector JSON-parses and source-validates every emitted source map inside the Playwright worker while both editors exist. This has no runtime reason: maps are immutable build output. Move static parsing/native closure verification to one bounded separate process after build and before browser startup; retain a hash-bound preparation receipt. Live collection must still verify actual CDP generated code against emitted hashes, stream-check map bytes against prepared hashes and copy the same exact files. No missing/tampered map or stale native binding becomes accepted. Final converter independently parses/checks the retained maps after browser ownership ends, as before. No explicit GC, input/window/budget/native algorithm change.

Before any new hosted runtime decision, perform one finite lower-layer memory probe using the already retained df76 code/maps, not a build/browser/native workload: baseline collector and revised live collector in separate child processes with identical fake-CDP returning exact retained emitted JavaScript, same30scripts, matching output hashes. Static preparation is separately bounded. Each child60s, combinedownedRSS2GiB, normal Macpressure, serial. Retain every child maximum-RSS receipt, the outer watchdog peak/final ownership receipt and output digests; no complete sampled time series is claimed. Establish source binding parity and reduced live peak; otherwise no resource-repair claim. This is a collector capability measurement, not a third native component/runtime experiment or latency acceptance. No forced GC or repeated sampling. Inputs stay original immutable artifact13422928142; invalid input aborts rather than substituting.

Review implementation and negative controls before the probe. Source paths and workload unchanged. Only after a concrete reduction is demonstrated can a prospective independent scope review consider one changed-source application validation. Failure/inconclusive result is terminal for this probe; no automatic renewal.

Operator benefits from truthful process ownership and less overlapping diagnostic allocation. Owner/Collaborator retain full original saved/peer/history/latency requirements; Link guest retains access/revocation. Complete XL scope and production qualification remain unresolved. User scope146+090thenstop.

## 📏 Fixed probe criterion and scope

The declared order is baseline collector → separate static preparation process →
revised live collector, once each, on the same original30-script inventory and
50,574,640code/map bytes. No warm-up, forced GC or repeated sample. Each child
reports Node's resourceUsage maximum RSS in KiB, supplementing the independent
serial watchdog's sampled total. A qualified capability result requires exact
output/source receipt and member-hash parity plus **at least64MiB and10% lower
live child maxRSS**. This is meaningful relocated collector allocation, not a
Linux browser headroom guarantee or a cause assigned to the old failed run.
Preparation time/peak is separately retained, never subtracted from app timing.
The parent checks the original ZIP and every extracted member before execution;
the output directory is create-once so an unchanged replay fails immediately.

Independent prospective review A requires source closure from actual loaded
scripts, map presence-transition and same-size tamper negatives, retained-map
revalidation after browser ownership, and the exact first violating resource
sample rather than a replacement inventory. The implementation retains those
boundaries. No workflow trigger is re-anchored and no new application execution
is admitted at this checkpoint; eventual hosted preparation wiring remains
pending any substantive lower-layer result and fresh review.
