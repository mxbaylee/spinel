# SPN-120 prior evidence and resumed local controls

Historical evidence, not current bcc1c17c acceptance. The successful baseline
(run41340400081, sourcee63956c7 plus explicit maxRetries1→0 diagnostic patch),
collection-only failed candidate (41342044627,5edd3665), and successful old
candidate (41342482185,0e0d0f07) retain exact raw result/identity reports,
source records, process/fixture journals and archive metadata/digests.
All nine downloaded ZIP digests matched GitHub metadata. Full ZIPs/HTML and
unrelated sync diagnostics are supplementary Actions artifacts expiring Nov15;
they are not represented as durably retained here.

The two original full-CI attempts41342457327 were cancelled and remain
non-passes. Raw attempt/job metadata records their results; cancellation cause
is unknown. The root agent later ran62localcontrols on integrated5ddf3142 and
15affectedprocesscontrols after removing the unused guard, with watchdog output.
Collection79tests at57b57a4e establishes discovery only. No retry conceals failure.
