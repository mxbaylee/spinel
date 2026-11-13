# SPN-149 terminal receipt assembly review

Reviewed 2026-11-13T06:45:27+00:00 by `/root/retained_evidence`. This is a bounded read-only review of the staged maintained evidence, not a code grade, live GitHub audit, or merge approval. No API call, test or validation workload was run.

## Outcome

**The 130-file terminal assembly is internally consistent, content-free and ready for evidence publication. No outstanding assembly finding remains.** It correctly records current-head acceptance as failed and PR #282 as draft, blocked and unmerged. It does not claim ticket completion or eligibility for branch cleanup.

This review covers the snapshot **before adding this review file**. Its exact self-excluding manifest SHA-256 is `576693d66e6cfd8adb79441238552a4d67424a376910e8eac0ef89033e3279df`. Adding this report and regenerating the manifest creates the next evidence snapshot; it does not change the reviewed source or CI result.

## Integrity and references

- **130 files; 129 manifest entries; 126 exact copies and three derived files.** All manifest lengths/hashes match, all 126 copy entries match their validation originals, the counters match their provenance, and there are no duplicate paths, omitted entries or extra files beyond the self-excluded manifest.
- **44 README internal links and 82 explicit acceptance JSON file references resolve.** The earlier missing historical references are present. All seven current required-gate entries, selected-family mappings, selected flags and the check inventory in acceptance.json exactly match reviewer A's final verdict.
- The current-run publication allowlist's **45 files** match their exact approved lengths/hashes. Its **seven hashes-only ZIP/log inputs are absent** from the receipt. No current-run file escapes that allowlist, apart from its explicitly publishable metadata; the separately reviewed scope/history additions are retained as declared. No ZIP, screenshot, trace or other raw browser binary is present.
- A bounded scan of all 130 files found no credential token, signed/private query, private JSON field or instantiated local request URL. Existing byte-exact native diagnostics and content-free failure extracts retain their approved boundaries. Public GitHub source/check/artifact IDs and URLs remain provenance, not fixture session or request data.

## Terminal result and source identity

The current source is `64d85c15288017bbfe3434d91fe0647eb2a2d613`, base `977de3a3a7608a05e2103787f4dac01ec180013e`, tested merge `6389a8c29b337b6e993b699d544ed2e43d86ffed`, and reviewed/tested tree `b293f8c3c816415864c09f185d77e717bab11e38`.

| Terminal measure | Verified result |
| --- | --- |
| CI 43373411759, attempt 1 | Completed; overall conclusion `cancelled` |
| CI jobs | 33 total: 31 success, one cancelled, one failure |
| Selected execution workers | 29 total: 28 success, one cancelled; none pending or omitted |
| Current-source checks | 43: 33 CI plus ten Storybook |
| Required gates | Six success; Playwright smoke check **131734863793 failed** |
| Blocking execution worker | Development 2/2 job **131715559252 cancelled**, with an independently disqualifying flaky first attempt |
| Storybook 43373411761, attempt 1 | Completed successfully; selected review workers passed |
| Merge / cleanup | No merge attempted; no squash commit; active unmerged branches retained |

The failed Space guest case remains retry 0 failed in **7,822 ms**, retry 1 passed in **41,501 ms**. The receipt preserves the absent first-attempt trace, missing exposed post-readiness process evidence, and uncertain reset/cancellation causes. It does not turn the passing retry, unchanged source, both passing revocation target cases or the two 100/100 source reviews into acceptance.

The preceding `hosted-blocked-verdict-43373411759.json` and other timed observations remain frozen historical records. The README explicitly explains that the terminal verdict supersedes their then-pending status. The maintained current run has zero running/queued workers and no contradictory pending or successful-merge claim.

Initial source `db24230` / run **43364365825** still owns the closed two-case fixed diagnostic sample. The older metadata execution **43370718838** remains successful history on its original source/base, and the integrated execution remains separate. Neither changes the original missing historical timeline or the natural-gap-not-reproduced conclusion.

## Earlier privacy-review dispositions

The owner-history parent reference now matches the finalized selected-worker file: **15,498 bytes**, SHA-256 `70f01ecc9e9e364db1b5947aee819abc0754e0bdc00bcb362ab19744caab53b8`. `publicationCorrections` explicitly preserves the earlier **15,082-byte** hash as a superseded unpublished snapshot. The cancellation wording now states **1,211 seconds**, consistency with the existing 20-minute budget, and an **unconfirmed trigger**. Both corrections are visible without erasing the earlier review finding.

The latest acceptance/README correctly distinguish the separate Space guest export symptom from SPN-120's finite historical sync snapshot case and do not assign a common cause. They preserve the need for a separately scoped evidence-backed next decision and all current-head acceptance requirements. Archive-pin/ref-deletion capability limits remain explicit, and neither active branch is described as obsolete or cleaned up.

## Reviewed anchor hashes

| File | SHA-256 |
| --- | --- |
| README.md | `41002a81a8098d33d69621518035c6b00766b9b755bfd1134265867dc90c2bf9` |
| acceptance.json | `507f7083bbcef7470baf910ddb9800a7ccde00a9e318afb3d8f29ffe2556e833` |
| hosted-final-verdict-43373411759.json | `db0d107996d2a6e99482c4185bdf62a6b78120bde5b82c33caa1755759135746` |
| hosted-publication-allowlist-43373411759.json | `6bcd5c098bd9f5fee0e764d18e4388ffb4626e3337e4117d71cf94dd784a0eec` |
| spn149-snapshot-owner-history.json | `b6cd985865e120cd89bc79337ab826733c7b10128a8d0fe11a8ebed4fce251d2` |

Only this separate review file was written. The staged receipt and source were left unchanged.
