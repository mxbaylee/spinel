# SPN-129 resumed integration evidence

Current source: de6549d0efe171aa3ad7ca7ad9f98d1f80df76a8.
Parents: b47daa699fa05ed98e1e2c54773426d4b0a83671 and
18a8759c498574a1d9cc24a969a558cd97a798ed (current main).
All local validation logs refer to the integrated code tree before its
implementation-record checkpoint was appended. Node 26.12.1, private npm ci,
shared serial lock, unchanged 2 GiB / 475-second watchdog.

Local: install, 87 focused CI-routing controls, full typecheck, lint/formatting
and current-main exact-title PR shape passed. No local browser execution.
These tests do not establish acceptance for the unresolved history-age defect.

Historical failure: run41392839303 attempt1 at b47daa69, tested merge
1dbbdf2539bcf7d0e87101f6a5fd379d2535dcaf. previous-ci-jobs.json retains all32
jobs. Sized restore job125108783201 failed at restore-browser.acceptance.ts
line1297 column83, sign-in-button click after anonymous /admin navigation.
The screenshot is the actual 1280x1000 first-failure page saying Not found;
it is failure evidence, not a proposed design or visual approval. JSON retains
bounded request diagnostics including /admin404 and the committed restore
followed by stage authenticating-after-session-reset. Main's existing /sign-in
fixture fix is included in the integration. No full restore pass is inferred.

Original artifact13118468827, sized-restore-acceptance, ZIP SHA-256:
31da1a8c2bc13dccbb50c50482cce6dc952bba5a21e2cc1018754037da8be97b.
The complete ZIP contains only evidence.json and failure.png; both are also
extracted here. Hashes were compared to GitHub's artifact digest. The evidence
contains synthetic fixture identities, code hashes and bounded runtime fields,
not authentication credentials. Raw job logs are not included; the initial gh
log download refused terminal escapes, then the connector log confirmed the
same recorded failure stage. Its full log remains supplementary hosted data.
Old source-event policy41392839326 is cancelled, not accepted.

Remaining: retention-safe history repair, GitHub App setup/access, protected
transition matrix, new hosted validation and two independent final scores.
No completion, waived acceptance, or production App activation is claimed.
