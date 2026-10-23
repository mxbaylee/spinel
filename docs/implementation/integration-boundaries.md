# integration-boundaries decision record

## Migrated decision history

Migrated by [SPN-096](SPN-096.md) on 2026-10-23. “Recorded” is the source issue opening
date, not an inferred owner approval date. Accepted choices are not evidence that
implementation or validation was complete. Historical permissions remain limited
to their recorded scope; current maintained rules and explicit supersession apply.

## Legacy decision 92: Stable integration boundaries

**Recorded:** 2026-10-19. **Status:** accepted.
**Authority:** Agent cross-feature architecture judgment.
**Source:** [original decision #92](https://github.com/mxbaylee/spinel/issues/92).

**Question:** Must future embed, replacement-sync and optional MCP work preserve the landed
guest-access, history-generation and live-commit boundaries?

**Options considered in the original source:**

A — reconcile future ticket requirements with these already-landed contracts. Embeds retain stable
source item IDs and resolve current generations; sync replacement preserves
guest/revocation/history/purge regressions; MCP reads/writes honor current grants and the live
commit/restore boundary. B — treat these integrations as independent paths and repair resulting
permission/history regressions later.

**Outcome, rationale and current boundary:**

Preserve logical document IDs, current authorization, native snapshots/history and generation-aware
mutations across collaboration replacement, restore, formulas and future MCP. Reuse the existing
authoritative commit/access boundary rather than letting integrations overwrite arbitrary snapshots
or infer access from cached data. This records constraints on future implementations, not permission
to expand any persona's capability or create a second content store.

**Persona tradeoffs recorded at the time:**

Owner needs restored documents to keep stable links and future integrations to preserve saved work.
Collaborator needs grants and concurrent editing to remain authoritative. Operator needs one
maintained commit and recovery boundary rather than divergent write paths. Link guest needs
immediate access revocation and no source-document or identity leakage.
