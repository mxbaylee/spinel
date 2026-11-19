# 🔎 Independent findings and repair disposition

Both independent nonimplementing reviewers inspected the complete SPN-156 L
candidate `32897ce33c7924835a2700955c182364fff50f44` against
`87c34e30ed810e6789d876e55b23dcbb349fa506`. This record contains substantive
findings and evidence without historical numerical assessments. Exact original
reports are preserved outside the blinded candidate and must accompany the final
immutable validation archive; they have not been destroyed or rewritten.

## 🛠️ Confirmed wrapper defect

`withOfflineItemWriter` registered an unresolved temporary-writer completion
promise before the potentially throwing `offlineEpoch()` call, outside cleanup
protection. A denied storage read refused the operation but stranded the
registration. After storage recovered, replay reservation remained refused and
editor admission awaited that failed writer indefinitely, despite no native lock
being held. Both reviews identified this sole implementation defect and the
missing direct-wrapper regression; no other actionable finding was reported.

Reviewer B's first actual-module reproduction used real Node Web Locks and the
actual exported wrapper/reservation/editor functions. It failed directly at an
expected function versus actual undefined reservation after storage recovery,
249 ms / 209,552 KiB. The raw scratch, receipt and output remain beside this record.
Reviewer A independently ran all six current owners: 186/186 passed, 9,720 ms /
997,072 KiB. Reviewer B ran the writer, persistence and lifecycle owners: 86/86
passed, 8,575 ms / 1,151,872 KiB. Those earlier successes did not cover this boundary.

## ✅ Repair and detecting contract

Capture the storage-backed epoch before allocating/registering a temporary
writer. Preserve original refusal and zero operation. The maintained regression
restores storage after refusal, requires an actual replay reservation, actual
editor item-lock admission and subsequent maintenance, then checks empty final
ownership. Restoring exact original source fails directly at the reservation
assertion before any potentially blocked editor wait. The positive, original-code
negative and exact-restoration receipts are retained beside this record.

The complete scope, four-persona tradeoffs, original first failures and unchanged
hosted/installed-phone requirements remain in `docs/implementation/SPN-156.md`.
No earlier assessment qualifies a new head or supplies a desired review outcome.
