---
id: SPN-157
emoji: 🛟
effort: L
phase: pre_launch
impact_operator: L
impact_owner: L
impact_collaborator: L
impact_guest: M
score: 32
depends_on: [SPN-160]
decisions: []
---

# 🛟 SPN-157 Recover maintenance and restore across process handoffs

## Story

As the [Operator](../product/personas.md#operator), I want maintenance and authenticated restore to recover safely when a process stops or readiness arrives before ownership, so that the workspace preserves its documents and returns a truthful operating state.

## Scenarios

### Reconcile an interrupted running phase

Given maintenance has durably recorded its running phase and retains the original rows,
When its process is killed and the supervisor reconciles,
Then it returns to maintenance with the original rows intact and orphan handles closed,
And uncertain ownership fails closed without exposing a writable or falsely ready application.

### Commit a ready authenticated restore

Given a complete application and authenticated archive pass validation,
When readiness arrives before the ownership handoff,
Then the selected candidate commits and is released within the existing deadlines,
And failed or interrupted handoffs preserve data, authorization and recoverable ownership with truthful failure diagnostics.

## Rules

- Wait on [SPN-160](SPN-160.md), the complete **M** internal failure-evidence prerequisite. This ticket remains open at **L**, with both original recovery investigations and all acceptance intact; the visible remainder is **M + L**. Diagnostic passage cannot prove historical causal repair. [Diagnostic prerequisite and retained scope](../implementation/SPN-157.md#-diagnostic-prerequisite-with-full-recovery-retained), agent judgment, 2026-11-13.

- Registration only; no repair or acceptance is claimed. The named supervisor failures on the SPN-098 candidate block its required validation. Unchanged supervisor files do not prove independence from the candidate's broader startup/drain behavior. SPN-090 separately waits on SPN-158; both PRs retain their own current-head gates. [Scope, evidence and four-persona decision](../implementation/SPN-157.md#-registration-and-complete-outcome), agent delivery judgment, 2026-11-13.
- Complete outcome **L** covers diagnosis, IPC/kernel/process lifecycle and durable-state reconciliation, restore authority and persistence, bounded cleanup, deterministic ordering/negative controls and actual Linux acceptance. Reassess at the early capability checkpoint before substantial implementation; split only with every remaining requirement and estimate retained.
- Diagnose failures in the named scenarios and repair the demonstrated product or fixture cause; the generic SIGKILL-case error may precede the crash or arise in later status, so reconciliation failure is not established. Preserve the original failure and successful comparator. Do not hide uncertainty with blanket retries, raised deadlines, skips or weakened readiness/data/cleanup assertions. The observed child handoff timeout is not an established diagnosis.
- Follow [sustainable testing](../testing.md); use existing supervisor fixtures and the lowest meaningful layer. Guest availability may improve, but no document or management authority changes.

## Out of scope

- Feedback/export implementation (SPN-098), phone offline behavior (SPN-090), file-list replay (SPN-156), general supervisor redesign or new deployment requirements.

## Verify

- Contract/negatives: extend `src/server/maintenance/supervisor.test.ts` and existing ownership/restore fixtures to control durable-running SIGKILL and readiness-first ordering; assert exact original/candidate rows, authenticated archive admission, commit/release, closed orphan handles and fail-closed recovery. Prove a broken handoff/reconciliation cannot pass.
- Readiness/cleanup: observe durable phase and actual process/IPC ownership, not sleeps; retain phase/action/lastFailure/controllerFailure and fixed-role handoff diagnostics without secrets. Close child groups, handles and temporary databases on success, failure and interruption.
- Environment/paths: deterministic tests own ordering/state transitions; bounded Linux supervisor integration owns actual SIGKILL, IPC/kernel and process/persistence behavior under unchanged deadlines. Include shared maintenance, ownership, restore, journal, fixture and CI-selection dependencies; a Mac pass cannot replace Linux acceptance.
- Evidence: preserve [both exact runs, source/base/merge/tree and test results](../implementation/SPN-157.md#-retained-first-failure-and-comparator), capability/scope checkpoint, first failures, negative controls and current-source Linux acceptance. No retry can erase the original failed verdict.
