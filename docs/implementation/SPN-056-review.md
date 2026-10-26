# SPN-056 integrated review

## Status

Work in progress, 2026-10-26. Baseline `12aa9b0d4f7c43f458729a38a390a5988d33bc58`
contains SPN-104, SPN-057 and SPN-058. The replacement remains disabled.
SPN-059 still owns activation and removal of Pro collaboration.

This review retains the [original acceptance](https://github.com/mxbaylee/spinel/blob/c8d356a16d0dd8fe30f19d90f84bee042e444cd8/docs/todo/SPN-056.md)
and [decision provenance](SPN-056.md). Earlier implementation scores and CI
are historical evidence, not grades or validation of this candidate.

## Initial independent findings

Two nonimplementing reviewers examined the integrated path on the baseline.
Neither established another queue, durable-ordering or authorization defect;
both found these explicit acceptance gaps that must be resolved here:

| Requirement | Repair/evidence in progress |
| --- | --- |
| Retained zero/negative drawings cannot stop subsequent native edits | Narrow pinned OSS refresh repair; remove the generator skip; native queue and reopen regressions |
| At least 100,000 mixed mutations with meaningful acceptance by family | Track original mutation provenance and mutually exclusive outcomes; assert accepted-share floors |
| Independent Doc and worksheet intent | Content/identity oracles with deliberately corrupted sensitivity controls |
| Random undo and redo in every family | Native history capture, random invocation and per-family accepted history counts |
| Actual loaded mutation inventory | Observe public registrations in the real editor presets and classify exact IDs |
| Concurrent hyperlink/Formula copy | Native paste through capture, queue, server and raw reopen; independent IDs and definitions |
| Sheet identities and formula targets through reconnect | Native Add/Copy/Rename races, pending formula references, immutable retries and raw reopen |

Tests added during this work are unverified until their exact result is recorded.
The first drawing fixture attempts did not reproduce the intended collapse and
failed their setup assertion; those runs are not evidence for the repair.

## Required owner decisions

The existing ticket requires explicit acceptance or revision of decisions 4,
20, 21, 23, 37, 39 and 40. Their status remains agent judgment; implementation
and independent review do not imply owner acceptance.

| Decision | Observable policy |
| --- | --- |
| 4 | Refuse simultaneous defined names with identical case-insensitive text, including across scopes |
| 20 | Refuse a cross-sheet cut racing deletion of its destination |
| 21 | Refuse deleting a name while concurrent structural work rewrites names |
| 23 | Treat absent or history triggers on name edits as possible structural rewrites |
| 37 | Refuse worksheet name/ID collisions instead of inventing a suffix that could redirect formulas |
| 39 | Conservatively refuse history cell writes racing formula/name edits when their original intent is ambiguous |
| 40 | Exclude only the two proven renderer-only drawing refresh IDs from outgoing edits |

SPN-058 also clears native undo/redo history after every accepted peer revision,
including one with no visible transformed edit. This prevents stale inverse
mutations from restoring outdated content. It means older undo is unavailable
after a collaborator edits. Own acknowledgments preserve the local history.

## Integrity and access boundaries

Review covers immutable retry identity; confirmed, inflight and buffered state;
server ordering and intermediate native validation; final transactional access
checks; restore-generation fencing; and membership/capability revalidation.
Runtime hashes cover touched Sheet cells or the Doc body. Drawing resources and
worksheet metadata require separate full-snapshot/reopen assertions; a matching
revision hash alone does not verify every native field.

## Persona effects and merge gates

Owners and Collaborators need preserved content and honest refusal/unsaved state.
Editing Link guests have the same integrity requirements within their exact
share scope; viewing guests gain no new editing capability. Operators retain
bounded work, durable receipts and metrics-only diagnostics.

Before closing this ticket: resolve every blocking finding and owner decision,
record two independent full-rubric assessments on the same current commit, pass
all seven required CI checks and applicable browser/Storybook verification, and
revalidate against current main. No activation or owner approval is claimed here.
