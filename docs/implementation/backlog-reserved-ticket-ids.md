# Registering an already allocated ticket

## SPN-130 reservation

2026-11-02 — accepted, agent judgment under the authorized backlog run.

At the initial checkpoint, SPN-120's selected validation was blocked by separately
owned Safari identity and Ubuntu mirror failures. Its proposed prerequisite-registration PR
passed backlog validation but failed the existing PR check: SPN-130 is below
main's `next_id` 136. That rule normally prevents ID reuse. Here, the ID was
already legitimately allocated on an unmerged branch and deliberately preserved
by SPN-131's registration. Renumbering it would violate the owner's never-reuse rule
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
main. The initial proposal preserved `next_id: 136`, the last grooming date and
all ten completions; integration below preserves current main's later values.

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
waive SPN-120's failed acceptance. SPN-130 registration and its Safari repair remain
pending; the subsequently merged Ubuntu repair still requires fresh validation
on this combined PR source.

## Resume after mirror repair and expose existing dependencies

2026-11-02 — accepted, agent judgment under the backlog run, after the owner
questioned why the displayed priority did not explain the SPN-131 selection.

SPN-131 PR237 merged as `43299f311d62fb73a5688a49471b71c626ea6e1d`, with
all seven gates, two independent grades and captured-profile installation proof.
It was selected as a prerequisite because both SPN-120 and this reservation PR
had failed before tests at the shared mirror helper. The lower displayed rank
did not show that repair chain. Its [final evidence](https://github.com/mxbaylee/spinel/tree/5c4977ac9019b2190d4cb7a61a209f3a6612d460/docs/review-assets/spn-131-final-evidence)
does not convert this PR's original failed/cancelled run into passing acceptance.
That [first failure remains retained](https://github.com/mxbaylee/spinel/tree/f955396a2e6faf5ece0d6ce00225393b58600b45/docs/review-assets/reservation-first-ci-blocked).

The fresh branch/chat audit found no competing active owner. Integrate current
main, preserving `next_id: 137`, all eleven completions and grooming date
2026-10-29. Resolve the configuration-only merge conflict by retaining those main
values and the existing SPN-130 reservation. SPN-136's retired allocation is not
reused or registered. The 41 backlog controls passed again on the integrated
source in 149.789625 ms (watchdog elapsed 190 ms, below its RSS sampling interval).
Run fresh full CI and obtain both final grades on the combined commit; no old
result substitutes for that acceptance.

Also make SPN-098's already-recorded SPN-135 prerequisite explicit in `depends_on`.
Its Rules and SPN-135's maintained record already block that feedback PR pending
the idle-latency disposition; this corrects index visibility without inventing a
new product dependency. The generated ordering must expose the same prerequisite
as the ticket's Rules. SPN-120's SPN-130 dependency belongs in the subsequent
registration PR, once this base-authorized reservation can be consumed; adding
a dependency on an absent ticket now would fail backlog validation.

Operator gets an accurate repair order and enforceable IDs. Owner and Collaborator
retain the existing responsive-document and genuine-validation requirements;
Link guest's access requirements remain unchanged. This is focused backlog
maintenance, not a full grooming or a reset of the completion reminder.
