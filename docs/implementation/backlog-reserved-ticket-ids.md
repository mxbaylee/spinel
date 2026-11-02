# Registering an already allocated ticket

## SPN-130 reservation

2026-11-02 — accepted, agent judgment under the authorized backlog run.

SPN-120's current selected validation is blocked by separately owned Safari
identity and Ubuntu mirror failures. Its proposed prerequisite-registration PR
passed backlog validation but failed the existing PR check: SPN-130 is below
main's `next_id` 136. That rule normally prevents ID reuse. Here, the ID was
already legitimately allocated on an unmerged branch and deliberately reserved
when SPN-131 landed. Renumbering it would violate the owner's never-reuse rule
and lose the existing scope/evidence links. Disabling the checker is rejected.

The actual allocation commit is
[`fefb3660cdfa363f4b80812df33a3a63a404b8ef`](https://github.com/mxbaylee/spinel/commit/fefb3660cdfa363f4b80812df33a3a63a404b8ef).
Its parent lacks `docs/todo/SPN-130.md` and has `next_id: 130`; the commit adds
that ticket and advances the counter to 131. Its exact heading is:

> 🔬 SPN-130 Diagnose the native desktop identity and storage-cleanup timeouts

`58dfc5390750ff84948fc4c0ad99b31824e4f69a` is a later integration merge, not
the allocation commit. [SPN-131's record](SPN-131.md#hosted-mirror-compatibility)
records the reservation observed there. The original allocation is an ancestor
of the current SPN-090 branch `e0abee43dcb5d7edcb2508e940733e730729b01c`.
`git log origin/main -- docs/todo/SPN-130.md` is empty at main
`1fca8a98c315d2f715e8051537e50f2efbbe580b`: the ticket has never landed there.
The original branch/worktree remains untouched.

## Decision and boundaries

Add an optional, small `reserved_tickets` list to the existing backlog settings.
Each record binds an already allocated ID to its exact original heading and full
allocation commit. This first grooming PR records SPN-130 and teaches the checker
the rule; it does **not** register or complete SPN-130. A later grooming PR must
consume the reservation from its **base**, add the matching ticket and remove the
record. Same-PR self-authorization fails. Existing reservations cannot silently
change identity or disappear without registration. Normal allocation and the
monotonic counter remain unchanged; implementation still requires the ticket on
main. Preserve `next_id: 136`, the last grooming date and all ten completions.

Schema validation rejects malformed records, noncanonical/future/duplicate IDs,
unknown fields, mismatched/multiline headings, invalid allocation SHAs, and
reservations for currently open or recently completed tickets. The checker does
not fetch historical commits: valid SHA syntax is not allocation evidence. Both
independent reviewers must verify and retain the original ticket/counter change
and full main-history absence before approving a reservation. A reset completion
list alone cannot establish that an ID was unused. Once consumed, the reservation
cannot admit the ID again; any new reservation requires separate provenance review.

This narrowly handles concurrent branch allocation using the existing settings
and grooming boundary. It adds no allocation service or runtime dependency.
Operator retains an enforceable repair order and audit trail. Owner and
Collaborator retain genuine document validation rather than bypassed gates.
Link guest's access assertions remain unchanged. No product UI changes or visual
capture are applicable. Agent review only.

## Test plan and evidence

The existing Node backlog suite owns configuration and PR-transition contracts.
Focused negative controls cover malformed/duplicate records, same-PR
self-authorization, wrong headings, unconsumed reservations, non-grooming changes,
silent removal/identity mutation, counter decreases, reintroduction after
consumption, and the unchanged ordinary allocation and base-ticket gates.
At first local execution all 41 backlog tests passed under Node 26.12.1 and the
shared serial/memory watchdog (168 ms; below the RSS sampling interval).

The code change requires current full CI, including all seven gates, and two
independent nonimplementing reviews on the same SHA. No application/browser
result is claimed by these local controls. Source changes under scripts/backlog
retain broad coverage; no routing is narrowed. This grooming does not repair or
waive SPN-120's Safari or Ubuntu failures. SPN-130 registration and both independent
repairs remain pending after this prerequisite lands.
