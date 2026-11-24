# 🔄 SPN-144 — offline-upgrade activation

## Registration and scope

**2026-11-04 — accepted registration, agent judgment under the owner's request
to resolve and merge SPN-089 / PR #260.** Record the independent activation
anomaly discovered by that PR's required CI without changing the dialog outcome
or weakening its current-head acceptance. Closing SPN-089 does not complete this
follow-up. This is pre-launch work under the existing lifecycle ordering.

### 🔎 Retained observation

Source `ee996e95e5a1ca117f4144e5e3950341eb97c6da`, tested merge
`39a9b6227e0eb4339adbe1b9e99606318e90ef21`, run `41927434953`, attempt 1,
job `126915583844`: the real SPN-054 eager-client scenario's second update
request returned, and the replacement worker became installed/waiting at 534 ms.
It remained waiting at 120,000 ms while the old worker stayed active. The helper
observed the transition; a merely missed installation event does not explain the
receipt. Its installation-worded error is less precise than the retained state.

The built-in retry passed and the worker job correctly failed under
`failOnFlakyTests`. Body-edit run `41929259741` later passed the same source and
tested merge without a logged retry. Neither pass identifies a cause or repair.
The [preserved receipt](../review-assets/spn-089-ee996e95/offline-upgrade-first-failure/receipt.json)
keeps the eight observations, source hashes, archive identity, useful image,
context and log. The original attempt has no Playwright trace ZIP; available
trace ZIPs belong to retry 1. Absence of that trace does not establish a browser,
resource or data-loss cause.

### 🧭 Scope and decision

The initial **M** estimate covers bounded diagnosis, a causal repair at the
existing worker/fixture boundary, meaningful regression protection and complete
current-head verification. Reassess immediately if the first capability
checkpoint exposes a larger lifecycle or platform investigation. Do not treat
the estimate as evidence that a cause is known.

Investigate whether the outgoing legacy worker has unfinished extended work when
the replacement waits. This is a discriminating hypothesis, not a finding. Both
legacy and current workers already call `skipWaiting`, and the scenario's
`holdResume` controls WebSocket frames rather than service-worker fetches.
Preserve the missing-asset negative case, existing budgets, strict first-attempt
rule, content/access assertions and first-cause cleanup throughout.

No current ticket owns this observable outcome: SPN-090 qualifies physical
phones, SPN-141 addresses native storage-loss preparation, and SPN-143 addresses
historical callback trace completion. Keep this distinct follow-up and its
original evidence; do not claim SPN-142's native Doc patch repairs activation.
A necessary fresh main integration must independently pass all current gates;
this registration cannot authorize a failed or incomplete acceptance run.

Owner and Collaborator need pending edits and retained files to survive updates.
Operator needs a trustworthy failure boundary and reproducible acceptance.
Link guest needs unchanged scoped access and recovery behavior. The registration
changes no application data, UI, permissions or lifecycle behavior for any persona.
