# 🔎 SPN-154 independent review B — retry candidate findings

**Exact head:** `d1d04ef634f745fcd86329c7e2ec42b69e698ccd`

**Base:** `2dc7871db0a9b7f368cda5fe260af012c70fb6b7`

Independent nonimplementer `/root/review_b`; **agent review only**.

**Grade: 93/100. Not approved for validation publication.** No CI-result deduction. Local checks have not been run on this candidate: reviewer A owned the slot while this source audit found concrete repair needs. Avoid rerunning known-defective source; review and run relevant tiny checks after repair.

## 🛠️ Findings and every step to 100

1. **Correctness: distinguish ready/preparing from failed recovery.** `scripts/ci/desktop-offline.ts` now sets `failed` whenever a Retry creating copy button exists. `web/SaveStatus.tsx` renders that same label for phase ready, and `web/spinelSync.ts` awaits readonly/persistence in prepareRecoveryAction before changing ready to creating. The new first observation can therefore terminate valid preparation as other-recovery-error. Require actual failure evidence, such as the existing recovery message/status element plus control, and add coverage for ready -> creating -> published versus genuine errors. This is a fixture regression, not evidence of a product recovery defect.
2. **Correctness: enforce the claimed single deadline at action/result boundaries.** The shared remaining() checks happen before waits. Existing until() returns an accepted browser read before checking elapsed time, so a final read begun inside 45 seconds may return after the deadline and still pass. Named target readiness can similarly consume the remaining interval before its click. Recheck deadline after successful publication observation and immediately before issuing the retry click; add bounded late-read/boundary coverage without increasing any budget.

These are the only identified steps to 100. The intended narrowly diagnosed explicit UI retry is acceptable; neither finding requires a production scheduler, automatic retry, broader sync changes or a waiver.

## 📋 Rubric

- Scope **35/35**: full original-ticket outcome retained; fixture-only diagnosed retry within the accepted boundary.
- Correctness **19/25**: four points for ready/failure conflation, two for missing late-result/pre-click deadline checks.
- Regression **19/20**: helper policy negative cases are meaningful, but the changed asynchronous UI-state/deadline boundaries lack coverage for the identified failures.
- Operations **10/10**: first failures and original identities are accurately retained; no CI-result deduction.
- Maintainability **10/10**: small policy helper and bounded observer, no production behavior expansion.

## 🧾 Inspection and retained positives

Full original-ticket/main implementation review from earlier records remains applicable. All product trees (`web`, `src`, `server`, `lib`) are unchanged from reviewed419773ed. Inspected full new executable delta, diagnostic maintenance text, retry source safety and server hashing. The server receipt hash calculation matches PortableFiles.recover exactly. The immutable saved request/checkpoint/images, original state and receipt assertions before retry, same recovery ID/hash after retry, single click branch and existing final content/image/authority checks are appropriate.

Verified all32 validation-52572987 and21 clipboard-d933 manifest SHA-256 entries. Prior Chrome/Firefox passes, Safari failures and d933 clipboard/application results remain attributed to their actual source/run identities. No old result becomes current acceptance. Existing historical archive/privacy/source checks and the owner physical-phone waiver remain applicable as previously recorded.

Fresh final-head native/hosted acceptance and all seven required gates remain required after repair. Physical-phone testing is not run and waived only by the explicit SPN-154 owner decision. This review does not certify unperformed platform or visual checks.
