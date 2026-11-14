# Bounded source audit — authentication readiness window

The failing call at restore-crash.integration.test.ts:206 occurs after the test
observes candidate-committed, then GET /api/auth/session returning 401. It has not
created the acknowledgement folder or sent postcommit-cut.

There is a source-proven window in which that oracle can pass before write admission:

- server/app.ts:236–252 deliberately bypasses MaintenanceGate for GET auth/session
  while paused, so 401 is not proof of writable admission. /api/maintenance is also
  mounted before the gate at 227; reading its epoch alone does not prove running.
- restore-http-test-client.ts:222–225 fetches that epoch and immediately POSTs auth
  options. Authentication options is gated, unlike the session read.
- server/app.ts:741 clears trialClosed during releaseRestoreTrial. The child then
  acknowledges release; supervisor.ts:2875–2884 awaits that acknowledgement before
  marking childReady and resuming. resume at 1252–1268 transitions to running.
- MaintenanceGate.running requires the current phase to be running (gate.ts:88–95).
  The release/open/paused interval can therefore return session 401 but auth-options 503.
- Existing maintenance/http.test.ts:304–310 explicitly expects auth-write 503 while
  paused, and the same suite allows session reads during pause. These are deliberate
  authority contracts, not permissions to weaken the gate for this fixture.

This establishes a weakness in the test's readiness oracle, not the full cause of
the particular hosted 503: the retained HTTP helper error omits response body/phase,
and controller stdout/stderr are ignored by this crash fixture. A later genuine
failure cannot be ruled out from that log alone. Capture truthful fixed-category
phase/admission diagnostics while isolating the boundary; do not invent them afterward.

A bounded candidate repair would wait for the actual application maintenance status
phase running inside the existing 20-second readiness budget, retain the session 401
assertion, then perform the unchanged authentication, acknowledgement write, SIGKILL,
content and orphan-handle assertions. A deterministic held-release/resume control
should prove that session 401 alone cannot authorize this step and the correct signal
waits. No global retry, raised timeout, skipped case or weakened authentication is needed.
The delivery manager subsequently assigned this bounded fixture-admission outcome
to SPN-158, distinct from SPN-157; registration and repair acceptance remain pending. No code change or rerun is made by this audit.

All source references are pinned to 67111d9c106c6518b813c6f1cf332068526c254c; unchanged
source relative to 27b87ff8 is a provenance fact, not proof of independence from broader
application startup/drain costs or runner scheduling.
