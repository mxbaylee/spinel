# Focused dependency-ticket registration

## Preserve SPN-099 and separate Dependabot enablement

Date: 2026-10-23. Status: accepted agent judgment under the owner's backlog-run
delegation. The independent `sync_sheet_review` agent assessed all four personas
and agreed with this sequence; the parent relayed that review in chat. This is
focused registration, not a full owner-led grooming or implementation approval.

Question: how can Dependabot reach the default branch before SPN-062 proves a
real updater-generated PR, without reusing an ID already allocated elsewhere?

Context: current main `7562f09f169a0da3524bf704ab19114191a0b37a` has `next_id: 99`.
The unmerged `origin/codex/spn-056-sync-transform` at
`f8732cfdf6b3e133e4973328210934e1233a8389` already allocated SPN-099, "Run Univer
core unpatched once upstream ships the fixes." Its required transform library
and convergence tests arrive with SPN-056. The prepared SPN-062 work includes
updater configuration, but GitHub must see that configuration on the default
branch before its real hosted update acceptance can be demonstrated.

Options: reuse 099 for the updater prerequisite; merge SPN-062 without its real
bump evidence; or preserve the existing reservation and register a separately
verifiable configuration prerequisite. Choose the third: ID reuse breaks the
ticket contract, and a representative local title check is not hosted evidence.

Outcome:

- Bring SPN-099 onto main with its existing identity, purpose and content from
  the source SHA above. Add the prerequisite SPN-056 and this provenance link;
  it must wait for the library/tests it verifies. This does not land SPN-056.
- Advance the allocator past that existing reservation, then use
  `npm run backlog:new` to allocate SPN-100, "Enable reviewed dependency update
  pull requests." The allocator advances to 101; SPN-056's eventual integration
  must preserve SPN-100 and the latest allocator rather than restore its old 100.
- SPN-100 enables only the reviewed Dependabot configuration under normal CI and
  independent review, with schema and primary-source validation. SPN-062 waits
  on it and retains its original runbook and real hosted bump-PR acceptance.
- This registration copies no updater configuration or prepared runbook and
  claims no hosted bot run. Preserve the grooming completion list and last date.

Persona effects:

- Operator: a small prerequisite makes updater rollout reviewable while retaining
  actual hosted evidence and safe patching verification in SPN-062.
- Owner: update review and the existing convergence-patch follow-up remain intact;
  no document or deployment changes occur in registration.
- Collaborator: the same review gates protect shared documents; no automatic
  deployment or interruption is introduced.
- Link guest: access and editing permissions are unchanged; the split adds no
  account visibility or new authority.
