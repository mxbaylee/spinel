# 🛑 SPN-098 metadata validation failure checkpoint

Reviewed implementation remains source `2204b8c40ce6feb8ad03c65720c976510535ad00`, base `ebf0842f51b60d54649cf8a03065914bec0944bf`, tested `62bc0229c5675ff519b733cfc8f3c9a7e6e918d8`. PR is draft and merge is blocked by the newer required Unit tests failure. Original successful acceptance is preserved separately in receipt.json; this failure is not erased by that earlier pass.

## 🔬 Observed failure

The one final-description edit triggered CI43544143900 attempt1 (pull_request/edited). Same full15-suite plan and exact source/base/tested; only the action field differs from initial acceptance. Supervisor job132291548937 failed2/131 tests, passed129. Unit tests aggregate132293846852 correctly failed. The two cases are durable-running SIGKILL reconciliation and real authenticated restore readiness-first. Original job logs and the prior successful job log are retained verbatim in gzip form, with decoded hashes below. A receiver ownership timeout appears in the log, but there is insufficient case-correlated progress to prove the exact cause or causal mapping.

The supervisor test hides phase/jobPhase/controllerFailure by comparing only ready:true; generic maintenance-control failures also omit the concrete action and failure state. This limits diagnosis. No product/test/infrastructure classification is asserted yet, and no timeout increase, repeated identical hosted run or feedback-specific cause is justified.

## 💻 Local platform limit

The one guarded focused local reproduction used Node26.13.0, the shared serial runner and normal memory pressure. It completed in10.782s at494,608 KiB peak. The real supervisor subprocess rejected macOS explicitly in journal.ts:86; the fixture consequently timed out waiting for a message. The real-app readiness-first case is explicitly Linux-only and skipped. This is not a reproduction of the Linux CI fault and not passing acceptance. No platform guard was bypassed and no repeat was attempted.

## 🧾 Status and retention

The run/job API snapshots are an in-progress checkpoint: useful remaining jobs were allowed to finish. Later terminal outcomes belong in a subsequent receipt. No implementation source changed. Only this evidence-only archive is intended for tag publication; existing workflow triggers exclude tag/create events. The manager may publish one failure-checkpoint PR-body edit and deliberately cancel only its own resulting metadata run, preserving this original failing run and its remaining evidence. All original byte streams and stored/decoded digests are recorded in files.json.

## 🧭 Assigned repair owner

Manager assigned separate pre-launch SPN-157 (L), with reassessment at the Linux/IPC/persistence capability checkpoint. The SPN-090 worker owns exclusive registration and the SPN-098 prerequisite link; registration is pending on main. SPN-098 implementation and exact-source reviews remain unchanged, with merge blocked.
