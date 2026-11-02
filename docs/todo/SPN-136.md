---
id: SPN-136
emoji: 🛰️
effort: M
impact_operator: M
score: 21
depends_on: []
decisions: []
---

# 🛰️ SPN-136 Diagnose rejected hosted Ubuntu mirror configurations

## Story

As the [Operator](../product/personas.md#operator), I want supported hosted mirror configurations to install dependencies reliably, so that required checks exercise the application.

## Scenarios

### Rejected configurations receive an evidence-backed disposition

Given the unexplained strict-pair rejections retained by SPN-131,
When the actual failing configuration is captured and diagnosed,
Then each supported profile has the smallest validated transformation or explicit no-op,
And malformed or unsupported input fails before writing, with useful nonsecret evidence,
And a bounded first-attempt hosted installation and existing smoke workload pass.

## Rules

- Retains the original SPN-131 repair outcome after its independently useful diagnostics/known-profile slice. [Scope and evidence](../implementation/SPN-131.md#diagnostics-slice-and-retained-repair), agent judgment under the backlog run, 2026-11-02. Closing SPN-131 does not complete this ticket.
- Diagnose all retained unexplained rejections, including runs 41381914361, 41457132216, 41460301620, 41460301816 and 41462944305. The actual rejected input was not saved. Provider or image correlation is not a diagnosis.
- SPN-131's one ordinary CI/Storybook sample observed only the known 144-byte profile in 24 invocations. Exact public Ubuntu mirror lines are retained; unknown text is redacted. If redaction hides the discriminating field, justify bounded additional nonsecret observation before execution.
- Preserve archive preference, unrelated configuration, every first failure, required gates, timeouts and smoke assertions. No blanket reruns, skipped installation, speculative provider-based branch, weakened checks or larger budgets.
- M covers one setup boundary and hosted proof; reassess immediately if the actual diagnosis expands that scope. The backlog agent implementing this ticket owns every retained diagnosis, repair and proof obligation.
- Follow [sustainable testing](../testing.md); keep the Verify plan and progress evidence current. [Policy](../implementation/SPN-115.md#guidance-for-every-open-ticket-and-progress-checkpoint), owner 2026-11-01.

## Out of scope

- SPN-120's finite fixture repairs, native desktop identity/storage cleanup, Doc latency, physical phone access and unrelated CI routing.

## Verify

- Extend `scripts/ci/prefer-ubuntu-archive.test.ts` and `ubuntu-mirror-evidence.test.ts` with actual safely retained profiles, original/preferred cases, duplicates/malformed input, unchanged unrelated lines and no write on rejection. Diagnose before changing the transformation.
- Preserve source/base/tested SHA, provider, both runner-header and environment image identities, safe original input/hash/redactions, install outcome, selected workload and cleanup. Retain immutable evidence rather than only expiring logs.
- Declare an evidence-backed bounded first-attempt hosted protocol before execution. Reuse existing selected workers and budgets; retain every failure and nonreproduction. New green observations alone do not explain prior failures.
- Keep helper/shared-dependency routing complete. Require all applicable current checks and two independent current-commit reviews; dependent PRs retain their own missing acceptance until actually validated.
