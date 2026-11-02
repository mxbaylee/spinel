# Reservation PR #236: blocked first CI

Source 523deeefd4645967bf90ee813ac58a257281b321, base 1fca8a98.
Run 41462944305, attempt 1, desktop job 125336656796 failed at the
unchanged strict Ubuntu mirror check before browser tests. Its original log is
retained. Both independent source reviewers found no defects, verified SPN-130's
original allocation and withheld final grades pending current acceptance.

The root agent deliberately cancelled the remaining run after preserving that
failure, to release capacity for the predeclared SPN-131 diagnostic. Ordinary
cancellation left the required aggregate queued; force-cancellation then completed.
This is a cancelled non-pass, not an accepted run. The branch must integrate the
separate mirror repair and run fresh required validation before merging.

Local 41-test backlog result is included. Metadata before cancellation and after
terminal cancellation records the partial results. No incomplete browser evidence
is claimed as passing, and no source finding is deferred by this checkpoint.
