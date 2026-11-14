# 🌷 SPN-128 current-main review preservation

This evidence-only archive is a direct child of reviewed candidate
`81841c50916aa6038df16f4598c0d1d37b0c0b71`, reviewed against actual main
`c1d0d6e8ded33c10cf555ed2ed05ffd9ebc3a423`. It changes no candidate source and
performs no test, source push, PR update, validation dispatch or merge.

## 👀 Original reports and execution limits

The same independent nonimplementing reviewers A and B each assessed the full
original L outcome at 100/100, with rubric 35/25/20/10/10, no actionable findings
and no unresolved review blockers. Their full original reports in `reviews/` are
unmodified. **Agent review only.** No grade certifies hosted acceptance.

- A's current 21-control selection was refused by the memory-pressure preflight:
  no serial/test child, no verdict and no JSON receipt. Its complete original log
  is retained, and the absent receipt is explicit in `provenance.json`.
- A's separately authorized, materially smaller bootstrap/renderer selection
  passed 4/4: 380 ms, 145,184 KiB. It is not a repeat of the refused full selection.
- A's earlier source-qualified 3812 privacy check passed 5/5: 257 ms, 227,120 KiB.
  Current source-equivalence verification preserves that evidence; it is not a
  new 8184 execution. The earlier Vitest preflight refusal and separately admitted
  resource abort (1,134 ms, 366,784 KiB, no completed test results) remain distinct
  outcomes, neither product failure nor pass. Their small original logs/receipts
  are retained under `prior-source-a-execution/`.
- B independently ran the current recovery selection: 30 passed and 21 Linux-only
  skipped, 1,255 ms, 391,584 KiB. Its current script selection passed 21/21:
  417 ms, 248,400 KiB. Both were first attempts without a resource abort.

`execution/` contains every current original execution log and produced receipt.
`audit/` preserves B's independent source-equivalence, cleanup and provenance
records plus the root's packet audit. The private configuration and watchdog are
included for command interpretation; no copied script was executed here.

## 🔗 Complete packet, exact bytes and historical links

`review-packet-81841c50.tar.gz` contains all 1,562 files of the exact reviewed
packet, including its own 1,561-entry manifest. It includes the complete binary
candidate diff, incoming executable delta, original ticket/personas/policies,
source bindings, 13 decoded logs and relevant historical evidence. Every tar
member was checked against the original packet manifest. `packet-bindings/`
provides the manifests, blinding audit and binding/brief prose directly.

Packet-manifest SHA256:
`9213b65ec42143110c1215b79d2c5d65e3e34dd78562e89894cbe503d652ee87`.
Compressed packet SHA256:
`f514738fc8a22cb7e66a9f6b19cdec7c113e762f8eb245a832295f70263f77ae`.

Only the external inspection copies masked prior numerical assessments. Original
maintained evidence remains unchanged, and the current original reports are
preserved unmasked after their completion. `provenance.json` binds all 25 copied
originals by byte hash. `manifest.json` seals this archive's payload files.

Large historical archives are referenced, not recopied:

- [Prior 3812 review and publication provenance](https://github.com/mxbaylee/spinel/tree/ba660d31d96949680e48ba44f33e2a46caac0dd8/docs/implementation/evidence/SPN-128-review-3812ed9b).
- [Original 2fc local evidence](https://github.com/mxbaylee/spinel/tree/7447da12a6c1a2f29c4b4d9b870b901f15c501bb/docs/review-assets/spn-128-current-local).
- [Original a6dd local evidence](https://github.com/mxbaylee/spinel/tree/ba5c9fd5868e5448882e976edc202ede4b234dd3/docs/review-assets/spn-128-current-local).
- [Original failed CI evidence](https://github.com/mxbaylee/spinel/tree/41e2a2868be914adec6da5eeccc0faba589c3ef2/docs/review-assets/spn-128-previous-ci).

## 🚦 Source-qualified review, pending acceptance

Publication and source validation remain queued behind earlier-ticket completion.
Any later actual-main integration requires a new committed head and the same
reviewers' revalidation. This archive preserves the current assessment; it does
not carry its grade onto an unreviewed source.

Corrected current-head Linux crash/cold-command, custody/grant/refusal/replay and
cleanup, selected first-attempt browser/native/startup/build/operational acceptance,
and all seven CI gates remain pending. Prior expiry failures, mobile latency,
uncaptured ECONNRESET, cancellations and resource/setup outcomes retain their
original identities and limits. No old green run is current acceptance.
