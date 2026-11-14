# Focused delivery-repair registration — 2026-11-13

## 🧭 Decision and boundary

**Date/status/source:** 2026-11-13, accepted agent delivery-manager judgment under
[standing persona authority](../todo/process.md#decisions) and the owner's current
continuous-backlog instruction. This is focused backlog maintenance, **not** a
full grooming, implementation PR, validation exception or declaration of launch readiness.

**Question:** how can already allocated outcomes and newly discovered independent
repairs become eligible for implementation while their original registration PR
is itself blocked by required validation?

The actual main is `ebf0842f51b60d54649cf8a03065914bec0944bf`. SPN-090 PR #224
at `67111d9c106c6518b813c6f1cf332068526c254c` contains allocations 150–157,
but its required recovery owner now fails before a postcommit SIGKILL. SPN-098
PR #227 at `2204b8c40ce6feb8ad03c65720c976510535ad00` remains blocked by two
different supervisor failures. Neither PR has merged; neither failure is waived.

Options were to wait for an unavailable registration prerequisite, recreate the
same outcomes under new IDs, or move their existing registration into a focused
maintenance PR and allocate only the newly demonstrated boundary. Choose the
last option. Import exact existing identities and retain their complete scopes,
phases and estimates; register new SPN-158 through the CLI. Keep SPN-090 and
SPN-098 open, with prerequisites SPN-158 and SPN-157 respectively. Original runtime
and workflow work stays in its own PR. No code, dependencies, CI routing, thresholds
or source acceptance is changed here.

Operator gets executable sequencing and truthful failure ownership. Owner and
Collaborator retain every pre-launch content, authentication, replay and recovery
obligation while their explicitly deferred phone/polish/cleanup work stays after
launch. Link guest retains scoped access and revocation, with no new offline store
or management authority. A distinct fixture improvement does not replace the
unresolved L supervisor investigation or turn a failed CI result into a pass.

## 🧾 Existing allocation audit

Remote main and the SPN-090 source branch were rechecked before the isolated
registration checkout was created. Main's complete history has no SPN-150–157
ticket paths. Main already completed SPN-148 and retains its existing SPN-149;
those identities and outcomes are unchanged. The following exact source commits
contain the original ticket headings and corresponding counter advancement:

- **🪩 SPN-150 Show a branded Spinel loading screen:** [allocation `8438ffac`](https://github.com/mxbaylee/spinel/blob/8438ffacdf67d0b891045498882cb993e81d0447/docs/todo/SPN-150.md), counter 148 → 151; that commit also contained the two colliding proposals later allocated fresh IDs 154/155.
- **🔑 SPN-151 Remove leftover BrowserStack hosted resources:** [allocation `c1dc4b36`](https://github.com/mxbaylee/spinel/blob/c1dc4b363717a68e1aa65f5a52ab6883a8df2a7c/docs/todo/SPN-151.md), counter 151 → 153, together with 152.
- **🍏 SPN-152 Verify offline behaviour on an iPhone:** [allocation `c1dc4b36`](https://github.com/mxbaylee/spinel/blob/c1dc4b363717a68e1aa65f5a52ab6883a8df2a7c/docs/todo/SPN-152.md), counter 151 → 153, together with 151.
- **🗂️ SPN-153 Fix macOS temp-path failures in script tests:** [allocation `1fdcfc86`](https://github.com/mxbaylee/spinel/blob/1fdcfc86146d8985eb68ec4ffd71f104f1a10d7c/docs/todo/SPN-153.md), counter 153 → 154.
- **📋 SPN-154 Pasting an image keeps the page and the edit:** [allocation `e057940b`](https://github.com/mxbaylee/spinel/blob/e057940b3a63f7e479237121bf318054a6ebbd90/docs/todo/SPN-154.md), counter 154 → 157, together with 155/156.
- **💨 SPN-155 No false offline message when a Doc opens online:** [allocation `e057940b`](https://github.com/mxbaylee/spinel/blob/e057940b3a63f7e479237121bf318054a6ebbd90/docs/todo/SPN-155.md), counter 154 → 157, together with 154/156.
- **🔁 SPN-156 Sync saved edits while the file list is open:** [allocation `e057940b`](https://github.com/mxbaylee/spinel/blob/e057940b3a63f7e479237121bf318054a6ebbd90/docs/todo/SPN-156.md), counter 154 → 157, together with 154/155.
- **🛟 SPN-157 Recover maintenance and restore across process handoffs:** [allocation `5344405d`](https://github.com/mxbaylee/spinel/blob/5344405d15f1b7861ac8b1ca7a60db836225a94b/docs/todo/SPN-157.md), counter 157 → 158.

For the merge allocation `e057940b`, inspect the diff against its first parent
`af7a6cf0562d132be76b251473d917c5cce97bf4` with rename detection disabled:
154, 155 and 156 are added and the counter advances from 154 to 157. The first two
preserve the outcomes of the unmerged 148/149 collision; they do not replace
main's completed/existing tickets. Source head `67111d9c` supplies the latest
requirements, owner clarifications and expanded complete-scope accounting.
Importing these already allocated IDs is not a second allocation or reuse.

SPN-158, **🛂 Wait for writable admission after restore**, is the only fresh
allocation. `npm run backlog:new -- 🛂 "Wait for writable admission after restore"`
ran once from counter 158 and advanced it to **159**, under the shared serial
runner and memory watchdog (314 ms, peak 157,232 KiB, normal pressure, exit 0).
There is no reservation exception or checker modification.

## 📋 Complete remaining outcomes

Pre-launch work retains SPN-150 **S** branded loading, SPN-154 **M** image-paste
reproduction/repair, SPN-156 **L** editor-independent replay with authority,
persistence, native capability investigation and phone observation, and SPN-157
**L** diagnosis/repair of the two named supervisor scenarios including Linux
process ownership and recovery. Each has its own canonical scope and all four
persona effects. SPN-158 is **M**, the complete post-restore admission fixture
outcome described in [its record](SPN-158.md); it retains actual Linux crash/write
acceptance, the existing single deadline, meaningful negatives and cleanup.

Post-launch placement is unchanged for SPN-151 **S** hosted BrowserStack cleanup,
SPN-152 **S** real iPhone verification, SPN-153 **S** macOS script-test path repair
and SPN-155 **S** transient false-offline feedback. SPN-151 still requires its
recorded per-deletion owner approval and unused-resource recheck; this PR does
not delete a secret, branch, label or provider key. Old provider reports remain
history. SPN-152's Android/desktop exclusion names SPN-090 ownership without the
old blanket assertion that those checks are all done.

The owner removed BrowserStack from SPN-090's acceptance provider requirements.
The [current immutable candidate reconciliation](https://github.com/mxbaylee/spinel/blob/67111d9c106c6518b813c6f1cf332068526c254c/docs/implementation/SPN-090.md#-current-branch-integration-and-remaining-outcomes)
records the exact own-phone observations, missing versions/build identity and
verification judgment. This registration carries the superseding decision into
the still-open ticket without importing the unmerged runtime or claiming a full
physical-phone matrix pass. SPN-090's own required current-head gates remain.

SPN-157's wording now distinguishes matching supervisor source files from causal
independence: broader SPN-098 startup/drain behavior may still contribute. No
cause is established merely because those files match main. SPN-158's proved
readiness-oracle weakness is distinct from its unproved historical HTTP 503 cause;
[the preserved stage and source audit](SPN-158.md#-first-failure-and-proven-readiness-gap)
retain that limit. No existing obligation is removed to improve a review score.

## 🔎 Dependency update review and verification

The 2026-11-14 UTC open-PR audit used both connected GitHub issue search for
`repo:mxbaylee/spinel is:pr is:open author:app/dependabot` and a complete 12-PR
CLI listing with authors/heads. There are **no open Dependabot PRs**. The open
numbers were 220, 223, 224, 227, 228, 229, 230, 246, 247, 260, 281 and 282, all
owned by `mxbaylee`. No pending update requires a security, compatibility, CI or
grouping disposition; no dependency is updated or merged by this registration.

Keep `grooming.last: 2026-11-12` and `completed_since: [SPN-148, SPN-145]` exactly.
No ticket is deleted or appended as completed. The generated index is rebuilt
with `npm run backlog:index`, never edited by hand. Documentation checks own
allocation history, exact headings, complete scope, local/immutable link targets,
phase/dependency ordering and the PR title/size/landing rules. No product or UI
change calls for new browser execution, screenshot capture or performance claims.

The CLI allocation passed as recorded above. Index generation passed in **337 ms /
157,776 KiB**, yielding 30 open tickets and SPN-158 score 24 through SPN-090's
dependency. The first backlog-check launch was refused by elevated memory pressure
at the watchdog preflight: no check process or receipt was spawned and no verdict
was obtained. After pressure returned to normal, backlog validation passed in
**396 ms / 158,112 KiB**, with only the documented ticket-length soft warnings.
No budget was raised or owner application stopped. Source/link inspection found
all local Markdown target files present; `git diff --check` passed.

The exact committed-head PR check, independent reviews and applicable hosted gates
remain pending at this preparation checkpoint; the final PR will record their
identities and results. A grade or documentation-only applicability result cannot
complete either runtime repair. This PR contains only Markdown under `docs/` and
`docs/todo/backlog.json`; no application verification was invented for registration.
