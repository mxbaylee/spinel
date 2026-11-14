# SPN-090 candidate recovery failure — first attempt retained

## 🧾 Historical partial checkpoint

CI 43548838838 attempt 1, recovery job 132306723772, source 67111d9c106c6518b813c6f1cf332068526c254c,
base ebf0842f51b60d54649cf8a03065914bec0944bf, tested merge 3a97ee4dcf0bc60c9918575f0d8cf4eced7bc1d4.
The exact report and source hashes are in manifest.json; original log and first-observation
job/run/plan metadata are gzipped alongside it. The first-observation metadata is partial. The later explicitly timed checkpoint
`partial-checkpoint-031128.json.gz` is **2026-11-14 03:11:28.902704 UTC**: CI was
still running, with the recovery job and Unit aggregate failed; no all-terminal or
acceptance claim is made. Archive preparation is dated in manifest.json.

The recovery owner failed 1/607 tests (606 passed), 1/47 files (46 passed), 239.11 seconds.
The case `real SIGKILL at postcommit preserves the durable restore decision and all retained evidence`
failed after 9.956 seconds with `Unexpected fixture HTTP status 503.`

The stack is restore-http-test-client.ts:204 (json), :208 (prove auth-options), :225 (authenticate),
restore-crash.integration.test.ts:206 (ownerClient.authenticate). At this point the test had
observed durable `candidate-committed` and auth-session 401, then fetched maintenance epoch;
the owner authentication options endpoint returned 503. The post-commit acknowledgement
folder had not been written, and `postcommit-cut` had not been sent. This is not evidence
that the later SIGKILL reconciliation failed. The stage and cause require investigation.

No rerun, fixture weakening, deadline increase or product repair is claimed. Runtime files
are identical between prior 27b87ff8 and 67111d9c, but byte identity alone does not diagnose a
race or exclude effects of the broader app/runner environment. The required failing gate
remains a blocker. This retained record does not broaden SPN-090's phone implementation.

## 🔎 Source and archive boundary

`source/` contains gzip-compressed exact source from the published head for the
observed stack, fixture and admission/release contract. Decompressed source SHA256
values and every retained payload hash are in manifest.json. The source audit separates
the proven readiness-oracle weakness from the unproved cause of this particular 503.
This archive contains no database, browser profile, cookie jar or new implementation.
The narrow fixture outcome was subsequently assigned to SPN-158; this record does
not claim that registration, implementation or actual Linux acceptance completed.
