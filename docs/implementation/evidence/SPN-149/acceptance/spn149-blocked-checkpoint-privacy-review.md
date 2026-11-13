# SPN-149 blocked-checkpoint publication review

Reviewed at 2026-11-13T06:40:52+00:00. Reviewer: `/root/retained_evidence`. This is a bounded evidence privacy and factual-limit review, not a source-code grade or merge approval. The reviewer previously assembled the owner-history record; the other four records were authored by separate agents.

## Verdict

**All five reviewed files are content-free and suitable for publication.** No credential, private fixture URL, actual session/socket/request identifier, network payload, authored fixture value, screenshot content or trace content was found. One versioned-reference clarification remains below; it is not a privacy problem or a reason to change source or rerun CI.

| Reviewed file | Bytes | SHA-256 |
| --- | ---: | --- |
| [selected-worker-failure-43373411759-131715559252.json](selected-worker-failure-43373411759-131715559252.json) | 15,498 | `70f01ecc9e9e364db1b5947aee819abc0754e0bdc00bcb362ab19744caab53b8` |
| [review-b-development-2-failure-43373411759.json](review-b-development-2-failure-43373411759.json) | 8,331 | `ac8629ff89a62b7e1aa232f2f329c95c557eb658de0ba1c4ae498e1e7dd6dee4` |
| [spn149-current-head-scope-assessment.md](spn149-current-head-scope-assessment.md) | 14,468 | `75a35d961544dfb612009ef75a75ad96b1e3b1b33f7bc3a76dc9bd52e9acb918` |
| [spn149-current-head-source-boundaries.json](spn149-current-head-source-boundaries.json) | 3,070 | `5084609b21702a56b62fa5bd79d7a90c4bde12b4629037b280f88f0bd1957636` |
| [spn149-snapshot-owner-history.json](spn149-snapshot-owner-history.json) | 19,011 | `1b1f96079a3905b4fe49fc6461fece45cdff28ce188cb45bfaaed04745578c59` |

## Privacy verification

Every file was inspected, with additional checks for credential tokens, signed query parameters, private JSON fields and instantiated local request URLs. The retained URLs identify public GitHub evidence/source resources; GitHub app, runner, check and test-case IDs are public validation metadata rather than application session/request identities. The safe log excerpt contains only runtime/checkout lines, the categorical reset, source locations, case/result counts and cancellation text. Its LF-joined digest independently matches `13c845ebf586acd3f3b27a9ab0d0c45fc7806c709388baa00dd320bdc06a5685`.

The screenshot/error-context/retry-trace records retain member names, sizes and hashes only. Their contents and the credential-bearing raw error/call log are excluded. No raw archive or full log was opened, copied or added by this review. Pattern scanning is bounded, so the categorical records and their task-specific data limits were also inspected directly.

## Factual limits verified

- All records identify candidate `64d85c15288017bbfe3434d91fe0647eb2a2d613`, base `977de3a3a7608a05e2103787f4dac01ec180013e`, tested merge `6389a8c29b337b6e993b699d544ed2e43d86ffed`, and reviewed/tested tree `b293f8c3c816415864c09f185d77e717bab11e38` consistently.
- The independently extracted case is retry 0 **failed, 7,822 ms**, then retry 1 **passed, 41,501 ms**, in different Playwright workers. Its report is flaky, with 74 expected cases, one skipped and one flaky. A successful configured retry does not erase the first failure or satisfy `failOnFlakyTests`.
- The retained first attempt has screenshot/error-context metadata and no trace; only retry 1 has a trace. The files do not reconstruct the failed attempt from that retry. This review cross-checked the records; reviewer B owns the direct archive/member verification.
- Source inspection independently confirms `e2e/app-process.ts:86–101` stops retaining readiness output, drains the pipes and returns only `close`. It does not expose a retained post-readiness tail/first-failure process state to the failing fixture. The records correctly withhold server-health, crash and stale-connection conclusions.
- All ten source-boundary rows independently match their exact base/head Git blobs and file SHA-256 values. Unchanged source and lack of direct observer imports support the stated scope boundary; they do not prove the absence of every possible indirect timing effect. The assessment expressly withholds causal attribution.
- The reset occurs during a saved-content export observation before its content assertion completes. It is not classified as pre-feature session setup. The records do not claim lost content, an authorization defect, infrastructure-only failure or failure of the SPN-149 closure observer.
- The current case is outside the exact SPN-120 named historical matrix. The records correctly describe related symptom history without assigning a shared cause or silently expanding that ticket. The scoped next step remains a blocked checkpoint and a separate evidence-backed ownership decision.
- The configured worker budget is 20 minutes; the job lasted 1,211 seconds. That timing is consistent with the budget but does not establish the cancellation trigger. Annotation contents remain unavailable. Preserve this qualification whenever summarizing the owner-history phrase “20-minute job cancellation.”
- The terminal run snapshot now records **run 43373411759 / attempt 1: completed, cancelled** (updated 2026-11-13T06:36:40Z); selected job **131715559252: cancelled**, and aggregate **131734863793: failure**. These outcomes keep acceptance blocked independently of source review scores and passing SPN-149 target cases. No completion, merge eligibility or gate waiver is claimed.

## Publication clarification

**Versioned reference:** `spn149-snapshot-owner-history.json.currentFailure.parentFailureRecord` identifies the earlier selected-worker snapshot: **15,082 bytes**, SHA-256 `d92e585f07b23d6449f173356e170cd880275f5363e2881a1918773194527360`. The currently reviewed file is **15,498 bytes**, SHA-256 `70f01ecc9e9e364db1b5947aee819abc0754e0bdc00bcb362ab19744caab53b8`. Retain or explicitly label the earlier snapshot as historical, or update that maintained reference to the finalized file while preserving the earlier observation provenance. Do not present the older hash as the current file's digest.

**Status chronology:** the selected-worker record's nested workflow status remains `in_progress`/null at its timed intermediate observation. This is valid historical evidence. The maintained latest README/acceptance must use the terminal run and aggregate records above, and should state that those supersede the intermediate workflow status. The reviewed scope assessment already keeps the PR blocked; no causal or ownership contradiction was found.

No reviewed file, repository source, receipt, test, workload or GitHub state was changed. Only this separate review file was written.
