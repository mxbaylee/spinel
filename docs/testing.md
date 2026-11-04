# Sustainable tests

Use this guide when writing a ticket's **Verify** section, implementing its tests,
and reviewing the PR. It carries SPN-115's coverage and compute decisions into
new and in-progress work; [the implementation record](implementation/SPN-115.md) preserves their
evidence. A test should protect an observable contract at the cheapest layer
that can actually detect its failure. More executions are useful only when they
exercise a different risk.

## Carry the plan through the work

Every open ticket's Verify section is a starting plan, not evidence of execution.
At kickoff or when resuming an existing PR, confirm its concrete suite and fixture
paths against current code. Record the contract and negative case, lowest meaningful
layer, readiness/cleanup boundary, environment owner and source/shared dependencies
before adding coverage. Use the ticket-specific guidance without replacing its
existing acceptance requirements. Documentation-only work records instruction/link
verification and why runtime tests are inapplicable.

Keep a short **Test plan and evidence** entry in the implementation record and PR
checkpoint: planned contracts/owners; checks actually run with source SHA, run and
attempt; first failures and their disposition; remaining evidence and next action.
Update it when a fixture, dependency, environment or acceptance requirement changes,
and before a handoff. Say planned, passed, failed, resource-aborted or unavailable
accurately; collection, mocks and old commits do not prove current runtime behavior.
The final PR replaces stale pending claims with the verified result and limitations.

Review test design with the implementation, not as a cleanup phase after it lands.
Fix races, redundant executions without distinct coverage, missing cleanup and
unhelpful failure diagnostics introduced by this ticket in the same PR. A separate
ticket may own an independently useful pre-existing repair, with evidence and scope
recorded; it cannot defer a required regression or turn a failed gate into a pass.
No new tracking service, duplicate evidence ledger or blanket test-count target is
needed. The ticket, implementation record and PR already hold this information.

## Plan the regression before the test

Name the behavior that must remain true, the defect that would make the test
fail, and the existing suite that owns it. Start with the ticket's scenarios and
affected personas, including denied access, persisted content and recovery where
relevant. Extend an existing case or fixture when it covers that boundary; do
not reproduce the implementation's branches as an independent expected result.

| Contract                                                  | Usual owner                                                       | Add a heavier layer when                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Pure transformation, selection policy or validator        | Focused unit test; built-in Node tests for scripts                | The wiring or runtime boundary can fail independently.                                |
| Persistence, authorization or API behavior                | Existing server/store integration suite with an isolated database | Browser sessions, lifecycle or native editing change the result.                      |
| Component states and interactions                         | Production-component Storybook stories and interaction checks     | The real application or native editor integration is the contract.                    |
| Native editing, browser storage, peer updates or recovery | The relevant Playwright project and fixture                       | Another protocol, build, device or instrumentation mode adds a distinct failure mode. |
| Input latency or callback lifetime                        | Existing candidate harness and its validators                     | A historical comparison is needed to establish the claimed improvement.               |

For a repair, reproduce the original failure or use a bounded negative control
that demonstrates detection. Assert the actual outcome: exact authored/saved/peer
content, undo/redo state, access denial or the established latency budget, as
applicable. A visible success message alone does not prove those contracts.
Documentation-only work needs accurate instructions and examples, not a runtime
test invented to mirror the prose.

## Keep fixtures repeatable and failures useful

- Reuse the nearest proven fixture and helper. Examples include
  `e2e/offline-fixture.ts`, `e2e/maintenance-fixture.ts`,
  `e2e/doc-responsiveness-fixture.ts`, `e2e/doc-touch.ts` and
  `e2e/sync-snapshot.ts`; inspect their assumptions before adopting them. Extract
  a shared helper when there are real callers with the same contract, without
  creating a general fixture framework for hypothetical uses.
- Give each case isolated data and identities, including across retries and
  projects. Close databases, contexts, servers and task-owned subprocesses in
  cleanup. Do not make a case depend on an earlier test's successful mutation.
- Set up unrelated authentication/data through established test fixtures. Exercise
  real sign-in when sign-in is the behavior under test. Wait for a meaningful
  ready state, response or bounded assertion; a fixed sleep is not evidence of
  readiness. Retry only a specifically diagnosed, safe transient operation;
  never repeat an entire user action that may already have succeeded.
- Keep first-attempt failures, `failOnFlakyTests`, bounded retries and existing
  budgets intact. Do not hide a race with broader retries, looser assertions,
  arbitrary delays, unconditional skips or a higher performance limit. Separate
  diagnosed fixture failures from product failures and retain both dispositions.
  SPN-115 routing does not resolve SPN-120's remaining fixture work.
- Make failure output identify the failed contract and relevant state without
  credentials or real user data. Keep the current result JSON, logs and failure
  traces. Performance acceptance uses its existing unprofiled first attempts;
  profiled diagnostics and successful retries cannot replace those samples.

## Give each browser execution a reason

Before adding a project, tag or duplicate execution, record which contract each
environment owns: development/production, HTTP/HTTPS, ordinary/instrumented
build, desktop/phone, and emulation/real device where relevant. Prefer an existing
owner. Preserve distinct security, packaging and observation-dependent assertions
even when the visible journey looks identical.

SPN-115's example is `e2e/doc-mobile.spec.ts`: `@phone-ordinary` marks only cases
whose extra sync-build executions add no assertion. Routine CI omits those
duplicates through `SPINEL_CI_FULL_COMPATIBILITY=false`; guest mutation denial and
native caret/peer/composition observations keep their required sync owners. Full
plans and local/unknown settings retain all combinations. The ownership rationale
is in [SPN-115](implementation/SPN-115.md#phone-contract-ownership).

When changing this ownership, compare Playwright's collected test identities in
both routine and full modes, then run the affected owners. Account for every
removed execution and any pre-existing runtime inapplicability. Collection proves
selection, not runtime behavior. A lower count or duration alone never justifies
deletion, and emulation must not be described as physical-device evidence.

## Keep coverage routing complete

Most new tests belong to an existing suite and need no new CI job. Check that
their source and shared dependencies select that suite automatically. The
maintained routing interfaces are:

| File                                                                    | Responsibility when a suite or dependency changes                                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `scripts/ci/plan.ts`                                                    | `suiteIds`, dependency predicates and each suite's selected/inapplicable reason, dependency description and inputs.  |
| `scripts/ci/changes.ts`                                                 | Complete immutable diff, including old/deleted paths, plan serialization/digest and suite outputs.                   |
| `.github/workflows/ci.yml`                                              | Expose outputs, schedule workers, wire `needs`, pass actual results to required aggregates, and retain evidence.     |
| `scripts/ci/coverage-result.ts`                                         | Include required worker results in the appropriate aggregate group and verify the plan's digest and tested identity. |
| `scripts/ci/plan.test.ts`, `changes.test.ts`, `coverage-result.test.ts` | Prove selection, event boundaries and rejection of incomplete evidence.                                              |

For example, the `unit-test-run` matrix supplies worker evidence for the plan's
`unit-tests` suite. The required **Unit tests** aggregate invokes
`coverage-result.ts unit`; the browser aggregate then verifies both that worker
evidence and the required aggregate's success. Preserve both layers when adding
partitions so skipped or failed workers cannot be hidden by a successful wrapper.

For a new suite or narrower applicability rule, change this wiring together.
Inventory direct and transitive inputs: shared helpers, auth, persistence, sync,
SDK/postinstall patches, runtime, build configuration, manifests and lockfiles.
Use the complete immutable event range, including both sides of a move. If the
dependency relationship cannot be proved, keep broad coverage. Unknown paths,
unavailable ranges, ambiguous events and base retargets select full coverage.

Add focused routing cases for a relevant source path and shared dependency,
deleted/renamed paths, unknown input, documentation-only input, added/removed
labels, title/body versus base edits, pushes and scheduled/manual events, as
applicable to the change. Required aggregates must reject a selected worker that
is missing, skipped, failed or cancelled; explicit inapplicability is the only
reason to accept skipped work. Preserve malformed-plan, digest/source mismatch
and failed-classification checks. A new worker must reach a required aggregate;
an isolated green or skipped job cannot satisfy that requirement. For changes to
check names, concurrency or event routing, verify the behavior on actual GitHub
events as well as in local classifier tests.

`ci-performance` and `ci-full` are additive. Removing either must retain every
path-required check. Candidate native content/access/integrity and applicable
latency checks remain automatic for application changes; historical comparisons
follow their dependency inputs or additive labels. Weekly/manual full coverage
is the backstop, not a substitute for applicable PR coverage. Keep the seven
stable required check names and separate policy/code concurrency. The
[PR edit policy](ci-pr-edits.md) owns cheap title/body validation and trusted
full-validation routing for base/ambiguous edits; its setup and protected-merge
proof are required before activation. Broad soak, retained
transition, container, BrowserStack and live-provider scopes are not permission
to narrow additional coverage without equivalent evidence.

## Verify once at the right scope and preserve the result

Use the pinned Node version and existing commands in [development](development.md#checks).
Run focused checks while repairing a concrete failure, commit the candidate and
obtain [both independent grades before a validation push](implementation/grooming-2026-11-02.md#review-before-push),
then run the required CI gates and acceptance checks on the published head.
Reviewers distinguish local evidence from pending hosted acceptance; grades do
not convert unavailable checks into passes. Prefer hosted CI for heavy work;
local workloads follow the [shared memory/watchdog rules](run-backlog.md#2-implement-one-ticket).
Draft [checkpoint pushes](run-backlog.md#checkpoint-pushes-and-deliberate-ci-use)
can preserve work while cancelling triggered CI. Record that cancellation and
pending evidence; preserve file-based selection and let fresh applicable checks
finish on the final reviewed head before merge. Coordinate agents' expensive runs.
Repeat or broaden a check to resolve a remaining risk or satisfy a gate, with the
reason recorded. CI changes themselves require full validation.

In the PR, name the contract, suite/environment owner, relevant dependency paths,
and how selection was checked. Include immutable base/head/tested identities,
plan/results, run attempts and every failure or retry disposition. Preserve
essential evidence in the PR description or maintained files before temporary
artifacts expire. If claiming lower CI cost, report selected coverage, wall time,
runner time, first-attempt failures and time to a useful failure; disclose source
and runner differences instead of presenting an uncontrolled comparison as a
benchmark. Keep required correctness coverage and budgets visible in that comparison.
