The historical mobile callback check again reached its 420-second deadline waiting for Chrome's JSON trace export, after completing 357 seconds of behavior. This candidate requests the same full native capture as protobuf, retains its original bytes, and performs guarded Perfetto conversion inside the existing observation deadline.

- Keep baseline `0e1df4725d9eccb77574d25e3eecdf678fe6ff44`, all 16 paragraphs / 2,086 inputs, throttle, six categories, 1 GiB non-overwriting buffer, callback caps and content/access/history checks.
- Bind original protobuf, derived JSON, converter binary, command results, parser statistics and source maps separately. Reject framing/hash errors, incomplete conversion and missing cleanup.
- Include converter children and files in cancellation. Preserve the first failure and secondary cleanup diagnostics; require identical converter authority across paired observations.

**Draft: actual hosted acceptance is pending.** Small retained-data probes do not prove full-trace memory, Linux behavior or the 420-second deadline.

🔎 **Local verification:** All 125 relevant controls pass, including truncation, process cancellation, rehashed invalid receipts, different supported converter binaries in a pair, and simultaneous primary/cleanup failures. Full lint, focused 12-root typechecking, backlog/index/title and whitespace checks pass. Full hosted typechecking and every selected runtime check remain pending.

🧾 **Reviews:** Source `7b06d7516c4c386f5a23044e74d0c09b95a5a929`; base `1045e729c391c47a9b6a895782a2fa69dc6fa044`.
Two independent nonimplementing reviewers, `/root/spn120_review_a` and `/root/spn120_review_b`, each grade this exact source **100/100** (35/25/20/10/10), with no unresolved source blockers. **Agent review only.** The earlier source scored 95/100 from each and was not pushed; its paired-authority and first-failure findings are repaired and preserved in maintained evidence. These grades authorize validation publication, not merge or a claim of hosted acceptance.

The [maintained investigation](https://github.com/mxbaylee/spinel/blob/7b06d7516c4c386f5a23044e74d0c09b95a5a929/docs/implementation/SPN-144.md) and [124-payload manifest](https://github.com/mxbaylee/spinel/blob/7b06d7516c4c386f5a23044e74d0c09b95a5a929/docs/implementation/evidence/SPN-144/manifest.json) preserve all first failures, verifier repairs and exact artifacts. The original native capability failed its malformed-input check. The guarded implementation's retained-data conversion preserves all 1,249 fixture events; only two converter-duration metadata counters vary. No browser workload was rerun or acceptance deadline extended.

⏱️ **Remaining:** All seven current-head CI gates; first-attempt full historical/current mobile and desktop callback pairs; independent unprofiled responsiveness/content/history/access checks; every other selected check; final evidence publication and guarded squash merge. SPN-141 remains blocked until this prerequisite lands and its own integrated checks pass. SPN-140 and SPN-120 follow.
