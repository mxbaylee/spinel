# 🔄 Offline activation registration provenance

**2026-11-05 — explicit retirement and fresh registration during SPN-089 / PR #260 integration.**
Main and this unmerged branch independently allocated SPN-144 to different outcomes.
Preserve main's canonical ticket and decision byte for byte, including the
SPN-141 dependency on it. The branch-only offline proposal is explicitly retired
as a conflicting unmerged registration, with no completion claimed. Fresh
[SPN-145](../../../todo/SPN-145.md) carries every outstanding offline-activation
requirement, estimate, negative case, strict acceptance rule and retained failure.
This is not a silent historical renumber or a reservation of an occupied ID.

## 🧾 Immutable original identities

| Record | Immutable allocation | Heading / disposition |
| --- | --- | --- |
| Branch-only offline proposal | [`866df9f34f8d1fa3d2782c5a9fe796e4744604c5`](https://github.com/mxbaylee/spinel/commit/866df9f34f8d1fa3d2782c5a9fe796e4744604c5) | 🔄 SPN-144 Resolve intermittent offline-upgrade worker activation — explicitly retired unmerged proposal |
| Canonical main registration | [`1045e729c391c47a9b6a895782a2fa69dc6fa044`](https://github.com/mxbaylee/spinel/commit/1045e729c391c47a9b6a895782a2fa69dc6fa044) / PR #264 | ⏱️ SPN-144 Complete historical callback evidence within its deadline — remains open and blocks SPN-141 |
| Fresh offline registration | CLI issued 2026-11-05T02:08:59.955Z against integrated main's next ID 145 | 🔄 SPN-145 Resolve intermittent offline-upgrade worker activation — remains open; next ID is 146 |

The original offline allocation is absent from both parents of `866df9f34f8d1fa3d2782c5a9fe796e4744604c5`.
Its integrating-main parent `eb32117f5d09c28cd411063256db6d645335ae8a` has
next ID 144; the allocation commit has next ID 145. The retained original CLI
log records success at 2026-11-04T23:51:05.805Z. Both original files are
unchanged through checkpoint `70b154f2bfb2cc5fc7b90e02cc0f74107ec2ddf1`.

| Verbatim record | Bytes | Git blob | SHA-256 |
| --- | ---: | --- | --- |
| [docs/todo/SPN-144.md](retired-offline-activation-ticket-144.md) | 3616 | `af92618f6bde60b7d214299a35ed0c51e0517ea3` | `db26557ae4a8f73240f6bd5b73bf89bfd5e1e8cd74bc490c4e98a38dc8f70828` |
| [docs/implementation/SPN-144.md](retired-offline-activation-decision-144.md) | 3260 | `5738fc1f7bc93934b5323133537827e8ff2bc602` | `4234f28253c14cbfd22f5dc9f9688aa8d3cd4a26d82b727f94133adc4964666f` |

These are verbatim historical records, including their original IDs and relative
links. Resolve those links at their [original source tree](https://github.com/mxbaylee/spinel/tree/866df9f34f8d1fa3d2782c5a9fe796e4744604c5),
not at today's canonical SPN-144. Historical receipts and helper evidence remain
unchanged. Any offline SPN-144 in evidence for `ee996e95`, `866df9f`,
`95d52be` or checkpoint `70b154f` means the retired proposal, not the
canonical callback ticket. Current explanatory links point to SPN-145.

## 🧭 Outcome, policy and verification

The [current decision](../../SPN-145.md#registration-and-scope) preserves the
unknown cause of the first installed/waiting timeout, the original eight-event
timeline, actual retained-client scenario, existing budgets, first-failure and
missing-trace limits, content/access assertions and cleanup. Retry and later-run
passes do not establish a causal repair. No SPN-089 acceptance gate is waived.

Both independent nonimplementing reviewers checked the collision disposition
against the no-reuse/no-renumber rule and the [SPN-136 retirement precedent](../../SPN-136.md).
An already-open canonical ID cannot be reserved for this proposal. The CLI's
fresh ID avoids introducing a reservation exception or lowering the counter.
The combined backlog has 22 open tickets, 20 recorded completions and next ID
146; grooming date 2026-10-29, reminder interval and all settings remain intact.
Owner and Collaborator retain the pending-work reliability obligation, Operator
gets attributable registration and failure history, and Link guest retains the
same access boundaries. No runtime behavior changes in this collision repair.

See the [latest-main integration receipt](latest-main-integration.json) for the
CLI log hashes, actual fresh backlog checks and source-equivalence boundaries.
