# backlog-workflow decision record

## Migrated decision history

Migrated by [SPN-096](SPN-096.md) on 2026-10-23. “Recorded” is the source issue opening
date, not an inferred owner approval date. Accepted choices are not evidence that
implementation or validation was complete. Historical permissions remain limited
to their recorded scope; current maintained rules and explicit supersession apply.

## Legacy decision 6: Independent review and coherent scope

**Recorded:** 2026-10-17. **Status:** accepted.
**Authority:** Recorded backlog process decision.
**Source:** [original decision #6](https://github.com/mxbaylee/spinel/issues/6).

**Question:** How should review findings be split without weakening the current ticket's acceptance
criteria?

**Options considered in the original source:**

A — use overlap with acceptance criteria first, then existing size limits to assess safe splits; B —
defer any finding above an arbitrary patch size, even if needed for acceptance; C — include all
discoveries regardless of overlap, growing unrelated changes into the PR.

**Outcome, rationale and current boundary:**

Require a nonimplementing reviewer, at least 95/100 and no blockers: scope 35, correctness 25,
verification 20, operations 10 and maintainability 10. Repair acceptance gaps in the current ticket;
split genuinely separable work with honest dependencies before line-count considerations. A high
score never waives a blocker. Decision
[#105](backlog-workflow.md#legacy-decision-105-deduct-unnecessary-complexity) later makes
unnecessary complexity an explicit maintainability deduction.

**Persona tradeoffs recorded at the time:**

Operator favours a predictable process with small reviews and explicit blockers; Owner favours
complete features that preserve documents; Collaborator favours fixes that preserve shared edits and
permissions; Link guest favours access boundaries that cannot be deferred merely to raise a score.
All four benefit from an independent review of the actual shipped slice.

## Legacy decision 52: Memory-watchdog CI-first exception

**Recorded:** 2026-10-18. **Status:** accepted, conditional procedure.
**Authority:** Owner, chat 2026-10-18.
**Source:** [original decision #52](https://github.com/mxbaylee/spinel/issues/52).

**Question:** When the memory watchdog blocks local tests, may a draft branch be pushed after local
typecheck, lint and backlog checks, with full unit/browser validation required in GitHub CI before
merge?

**Options considered in the original source:**

A — authorize only this pre-push ordering exception when the guard blocks safe local execution; keep
local lightweight checks, draft status while unverified, independent review >=95/no blockers, and
all six CI checks before merge. B — retain the local full-suite gate and wait for sufficient local
capacity or an independently authorized test host.

**Outcome, rationale and current boundary:**

When the memory watchdog prevents safe local full testing, run local typecheck, lint and backlog
checks, push a draft and obtain full unit/browser CI. Keep the PR draft until verified and require
all six gates plus independent review at least 95 with no blockers before merge. This is a
conditional resource procedure, not permission to skip failed checks, buy a host, spend money or
invent local test results.

**Persona tradeoffs recorded at the time:**

Operator needs the Mac to remain responsive and predictable checks; Owner needs preserved documents
and complete regression verification; Collaborator needs concurrency and permissions tested; Link
guest needs access boundaries tested regardless of runner location.

## Legacy decision 105: Deduct unnecessary complexity

**Recorded:** 2026-10-20. **Status:** accepted.
**Authority:** Owner, chat 2026-10-20.
**Source:** [original decision #105](https://github.com/mxbaylee/spinel/issues/105).

**Question:** Should independent review explicitly assess over-complexity?

**Options considered in the original source:**

A — explicitly assess unnecessary abstraction, dependencies and speculative flexibility within the
existing maintainability category, with concrete deductions. B — leave the implicit maintainability
wording unchanged.

**Outcome, rationale and current boundary:**

Make over-complexity an explicit part of the existing ten maintainability points: deduct for
unnecessary abstractions, dependencies and speculative flexibility with actionable reasons. Keep the
other rubric weights, at least 95/100 and no-blocker threshold. Simplicity does not justify missing
acceptance, privacy, durability or verification. This clarifies decision
[#6](backlog-workflow.md#legacy-decision-6-independent-review-and-coherent-scope) rather than
introducing a competing review gate.

**Persona tradeoffs recorded at the time:**

Operator benefits from fewer dependencies and moving parts. Owner gets complete features with lower
maintenance cost. Collaborator and Link guest benefit from easier-to-audit permission and data
boundaries.

## Legacy decision 121: Documentation-only CI applicability

**Recorded:** 2026-10-20. **Status:** accepted.
**Authority:** Owner, chat 2026-10-20.
**Source:** [original decision #121](https://github.com/mxbaylee/spinel/issues/121).

**Question:** Can documentation-only changes finish CI without running application suites?

**Options considered in the original source:**

A — a narrow allowlist of `docs/**/*.md`, root README.md/AGENTS.md/THIRD-PARTY-NOTICES.md, and
exactly docs/todo/backlog.json, with backlog/PR/lint checks retained; B — run all application suites
for every prose edit; C — skip by broad extensions, which would miss configuration changes.

**Outcome, rationale and current boundary:**

Classify the complete change including both sides of renames. Only docs Markdown, root
README/AGENTS/THIRD-PARTY-NOTICES and exactly backlog.json qualify; executable mocks, unknown paths
or uncertain diffs run full validation. Keep Backlog/Pull request/Lint; other required application
gates explicitly report not applicable for docs-only work. Failed/cancelled classification never
passes the browser gate. Main/manual Storybook still builds/deploys so docs cannot displace a code
deploy. This is applicability, not permission to ignore failures or weaken protections.

**Persona tradeoffs recorded at the time:**

Owner and Collaborator benefit from faster grooming and unchanged application coverage for code
changes. Operator avoids unnecessary builds while retaining validation of operational code and
configuration. Link guest access tests remain required whenever runtime or unknown files change.

## Legacy decision 129: Fixed lifecycle phases

**Recorded:** 2026-10-21. **Status:** accepted.
**Authority:** Owner launch sequencing; agent scheduling model, 2026-10-21.
**Source:** [original decision #129](https://github.com/mxbaylee/spinel/issues/129).

**Question:** How should the backlog enforce the owner's before-launch, launch and after-launch
sequencing without distorting technical dependencies or impact scores?

**Options considered in the original source:**

A — use pre_launch (default), launch and post_launch, sort phase before existing score/tie-breaks,
complete the current phase before advancing and reject dependencies on later phases; B — rely on
prose plus scores, allowing inherited priority to move optional work ahead of launch; C — build
configurable lifecycle states and scheduling rules, adding flexibility that this backlog does not
need.

**Outcome, rationale and current boundary:**

Use pre_launch default, launch and post_launch ahead of existing score/tie-break ordering, and
reject dependencies on later phases. Complete the current phase or record its blocker before
advancing. SPN-038 is the public-launch milestone; optional CSV/plugins follow it. Current grooming
also places SPN-063 recovery verification in launch, after concrete deployment/database selection
and before SPN-038 public exposure. Keep impact/scoring, dependency inheritance, split/review and
size rules unchanged. These are timing constraints, not a technical claim that CSV/plugins require
HTTPS or permission to provision resources.

**Persona tradeoffs recorded at the time:**

- Operator: fixed phases keep launch prerequisites ahead of provisioning and optional extensions, with a small auditable scheduling rule; an arbitrary workflow framework would add maintenance.
- Owner: production launch stays a visible milestone and optional CSV/plugins cannot consume the launch queue merely because their scores are higher.
- Collaborator: core save, access and recovery work remains ahead of optional document formats, while ordinary dependency priority is preserved within each phase.
- Link guest: launch access and privacy acceptance remain prerequisites; future plugin or conversion work does not imply expanded guest access.

## Legacy decision 139: Run-specific delegated visual approval

**Recorded:** 2026-10-22. **Status:** accepted, historical run-specific authority.
**Authority:** Owner, chat 2026-10-21.
**Source:** [original decision #139](https://github.com/mxbaylee/spinel/issues/139).

**Question:** How is UI/UX approval handled during the owner's authorized Pages-first backlog run?

Tickets: SPN-064, SPN-092 and subsequent eligible tickets in this run; SPN-056 is excluded because
another person is implementing it.

**Options considered in the original source:**

A — require owner review before each UI merge, blocking this authorized unattended run; B — require
an independent subagent to inspect actual light/dark/phone screenshots and UI/UX for every persona,
record concrete findings, repair blockers and label merges “agent review only.”

**Outcome, rationale and current boundary:**

For the authorized Pages-first run only, an independent nonimplementing subagent could inspect
actual light/dark/phone UI and all personas, repair blockers and approve with explicit
agent-review-only disclosure. Preserve exact-head review, all CI, current main, squash, lifecycle
and external-action gates; SPN-056 was excluded. This is not fabricated human screenshot sign-off or
permanent delegation. A later run needs its own direct owner authorization; the current conversation
supplies its separate renewed scope.

**Persona tradeoffs recorded at the time:**

Operator benefits from independent usability/resource/privacy review and fewer unattended stalls;
Owner retains actual screenshot evidence and a transparent review record; Collaborator receives
keyboard/touch/access/error-state review; Link guest receives explicit anonymity, scope, revocation
and unavailable-state review. Human taste feedback may follow later; that tradeoff is explicitly
accepted by the owner.
