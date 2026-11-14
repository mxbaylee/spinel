---
id: SPN-160
emoji: 🧯
effort: M
phase: pre_launch
impact_operator: M
impact_owner: S
impact_collaborator: S
impact_guest: S
score: 33
depends_on: []
decisions: []
---

# 🧯 SPN-160 Preserve actionable maintenance handoff failures

## Story

As the [Operator](../product/personas.md#operator), I want maintenance checks to retain the first failure and bounded handoff progress, so that I can investigate failed recovery without losing its cause to a later timeout.

## Scenarios

### An action fails before the intended crash point

Given a maintenance transition has started but its durable crash barrier has not been observed,
When the action rejects,
Then the check immediately reports its original cause and bounded action, stage and journal context,
And it removes its pending message listener and timer without an unhandled late rejection.

### A handoff or readiness check fails

Given ownership transfer or authenticated restore readiness is being observed,
When a failure interrupts it,
Then the first bounded sender, receiver, phase and controller evidence survives cleanup and the existing error wrapper,
And missing or late observation cannot alter recovery, authority, persistence or deadlines.

## Rules

- Complete **M**, pre-launch, includes useful failure reporting, immutable bounded handoff receipts, readiness context, privacy, cleanup, portable negatives, integration and actual Linux diagnostic acceptance. [Scope, provenance and four-persona decision](../implementation/SPN-160.md#-complete-diagnostic-outcome), agent judgment, 2026-11-13.
- The proven source defect swallows pre-barrier transition rejection and later reports a message timeout. This does not establish either original SPN-157 incident's cause. Retain both failures and SPN-157's complete **L** outcome; SPN-098 still waits on SPN-157. Remaining work is **M + L**. [Retained scope and boundaries](../implementation/SPN-160.md#-retained-recovery-scope-and-neighboring-work).
- Tolerate intended RPC rejection only after observing the crash barrier. Preserve the original 10-second message deadline and crash assertions; remove timers/listeners on barrier, early failure and timeout, and handle late rejection.
- New handoff receipts contain fixed counts, booleans and machine codes only: no content, credentials, authority, paths, transfer IDs, nonces or arbitrary payloads. Keep public errors generic and original internal causes. No new protocol callback, timer or awaited work; observation must not change behavior.
- Capture readiness phase, job phase, lastFailure and bounded controller category before cleanup, including polling failure/unavailable job files. Preserve frozen first-failure progress through the existing single Error.cause wrapper without getters or cyclic/unbounded traversal. No retry, skip, raised deadline, CI narrowing or new service.
- SPN-123 retains production emitters/exports and measured overhead; SPN-128 retains the journaled preserved-original recovery command and crash cuts. Neither is completed, replaced or expanded here. Follow [sustainable testing](../testing.md).

## Out of scope

- Repairing unknown original recovery causes, changing admission/handle ownership/process containment, production observation inventory, new recovery commands, tracing services or infrastructure.

## Verify

- Portable contracts: reuse ownership and supervisor-test-control fixtures for request/offer ordering, wrong/duplicate acknowledgements, zero/two-handle interruption, missing-held deadline, late immutable callbacks, retained parent listeners, direct/wrapped extraction, getters and cycle/depth limits. Test sync/async pre-barrier rejection, observed-barrier crash rejection, unchanged timeout and late rejection with real temporary journal context; require zero leftover timers/listeners and excluded unrelated data.
- Native acceptance: existing Unit tests recovery and supervisor owners use Node 26.13.0, Tini/private PID namespace, real Linux abstract Unix leases, IPC handles and SQLite. Verify interrupted transfer after two accepted handles, no SQLite open, preserved bytes, closed late handles, plus actual durable-phase and authenticated restore readiness with improved reporting. No Mac substitute or new matrix.
- Routing/evidence: preserve ownership, supervisor, journal, fixture and shared CI dependencies; selected missing/failed/cancelled work must fail aggregates. Retain exact sources, original failure, first instrumented outcome, diagnostics, controls and cleanup under unchanged budgets. A pass without recurrence proves no historical causal repair; further experiments need a concrete hypothesis.
