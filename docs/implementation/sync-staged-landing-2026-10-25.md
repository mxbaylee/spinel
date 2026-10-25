# Staged landing of Spinel's collaboration replacement

## Land the library and retain SPN-056 for integrated review

Date: 2026-10-25. Status: accepted direction from the owner, with the ticket
allocation and dependency sequence chosen by agent judgment. Source: owner chat
2026-10-25 asked for a full independent score, conditional landing if the branch
passes, and retention of SPN-056 for a second agent's review so other work can
merge. The owner then requested another repair round to reach the review gate
and passing CI. This record does not claim that either implementation or review
has passed.

Question: how can the first transform implementation land as a bounded,
independently verified slice while the original SPN-056 ID remains open for a
meaningful second review before production use?

Context: the original [SPN-056 specification at `c8d356a`](https://github.com/mxbaylee/spinel/blob/c8d356a16d0dd8fe30f19d90f84bee042e444cd8/docs/todo/SPN-056.md)
covers the reusable transform library and its tests. [PR #151](https://github.com/mxbaylee/spinel/pull/151)
implements that library and supporting validation. The server, client and cutover
already have separate tickets. The [fresh review](https://github.com/mxbaylee/spinel/pull/151#pullrequestreview-5644879820)
found unresolved sheet-name/formula integrity and serial-runner ownership defects;
a green CI result at its reviewed head does not resolve those findings.

The backlog checker deliberately treats a ticket PR as completion: its ID must
already be open on the base branch, the PR must delete only that ticket and
append only that ID to the completion list. It also forbids reintroducing an old
ID as a new ticket. Keeping SPN-056 in its own completion PR, deleting and later
recreating it, or calling implementation a grooming PR would violate that
contract. No checker, title exception, size limit or review gate is changed.

Options considered:

- Finish and close SPN-056, then allocate another review ID. This is mechanically
  simple but does not retain the original ticket as the owner requested.
- Retain SPN-056 while modifying the completion checker to support stages. This
  would add process machinery solely for this landing and make completion
  ambiguous.
- Register a new implementation ticket while retaining SPN-056 continuously as
  the second pass. This uses the existing split/grooming contract and gives each
  landing one observable outcome. Choose this option.

Outcome and sequence:

1. In a focused backlog-maintenance PR, allocate SPN-104 using
   `npm run backlog:new`. Copy the original library acceptance into it, including
   supported mutations, open-source-only derivation, reusable packaging, Doc
   ranges, pair tests and the 100,000-operation convergence run. Keep the original
   immutable spec and PR/implementation history as review provenance. Registering
   the first pass does not count it as completed.
2. Keep SPN-056 continuously open, revise it to independently review the real
   integrated sync path, and make it wait for SPN-058. This review remains in the
   pre-launch phase. Its exact-head score, finding dispositions, evidence and
   limits must be preserved after completion. Use a fresh agent that did not
   implement the reviewed candidate; do not provide a desired or prior grade.
3. Retarget PR #151's completion bookkeeping to SPN-104 after registration is on
   main: use SPN-104's exact heading, delete/count SPN-104 only, retain SPN-056 and
   remove SPN-104 from dependent tickets when it actually lands. Preserve the
   existing `docs/implementation/SPN-056.md` provenance rather than renaming its
   history. Fresh review and all required exact-head CI gates still apply.
4. SPN-057 and SPN-058 may land the server/client behind their existing disabled
   flag. SPN-056 then reviews actual consumers, including native command capture,
   pending and confirmed state, durable ordering, retries, reconnect, and raw
   native snapshot reopen. It must assess test independence and coverage, data
   integrity, authorization and documented residual limits, rather than repeat
   a library-only score.
5. SPN-059 waits for both client implementation and the passing SPN-056 review.
   Activation, flag removal, retained-data transition and Pro removal remain in
   SPN-059. The phase gate still requires all pre-launch work before SPN-038;
   this change grants no deployment authorization.

The registration dependency graph is:

| Ticket | Depends on | Reason |
| --- | --- | --- |
| SPN-104 | — | Library implementation can be verified independently. |
| SPN-057 | SPN-104 | Server needs the delivered transform library. |
| SPN-058 | SPN-057 | Client needs the server protocol. |
| SPN-056 | SPN-058 | Second review needs the real integrated path. |
| SPN-059 | SPN-058, SPN-056 | Cutover needs both implementation and review. |
| SPN-099 | SPN-104 | Removing the core patch needs library regressions, not cutover. |

Remove an edge when its prerequisite actually completes under the existing
landing rules. Do not leave SPN-057 depending on SPN-056, which would create a
cycle through SPN-058. The historical SPN-099 registration remains authoritative
for its identity and patch-removal acceptance; only its library prerequisite
moves to SPN-104.

This is a split of implementation and subsequent integrated verification, not a
reduction of the original implementation acceptance. The currently known
sheet-name collision and formula-target defect belongs in the first pass. It
must be repaired and covered in CI before SPN-104 can pass; the runner finding
and required-check documentation must also be resolved in the delivered slice.
Any later supported-operation data loss or unsafe access found in the second
review blocks activation until repaired. A deferred capability must remain
explicitly unsupported and safely rejected, with the existing consumer contract;
no implementation note silently grants owner acceptance of data loss.

Persona effects:

- **Operator:** smaller coherent landings and a disabled integration flag make
  failures easier to isolate. The integrated review checks durable commits,
  retries, bounded operation and access enforcement before cutover. No deployment
  or new infrastructure is authorized.
- **Owner:** the original document-integrity acceptance remains in the first
  implementation; a separate review checks intent and reopen/reconnect behavior
  with real consumers before the replacement becomes active.
- **Collaborator:** server/client work can progress while the original second-pass
  ticket remains visible. Pending work, acknowledgments and rejected edits must
  be represented honestly, with no unresolved data-loss blocker at activation.
- **Link guest:** the review includes editor/viewer authority and live revocation
  at the integrated boundary; the split adds no visibility or permissions.

This is focused maintenance, not a full owner-led grooming. Preserve
`grooming.completed_since` and `grooming.last`, advance only the normal ID
allocator, and regenerate the index. This registration itself implements no
runtime behavior and claims no passing CI or implementation review.
