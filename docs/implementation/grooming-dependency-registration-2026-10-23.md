# Focused backlog registration and owner scope updates

## Preserve SPN-099 and separate Dependabot enablement

Date: 2026-10-23. Status: accepted agent judgment under the owner's backlog-run
delegation. The independent `sync_sheet_review` agent assessed all four personas
and agreed with this sequence; the parent relayed that review in chat. This is
focused registration, not a full owner-led grooming or implementation approval.
The SPN-062 sequencing in this initial decision is superseded by the owner's
later direction below; the SPN-099 reservation remains valid.

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

## Align work with the undeployed product

Date: 2026-10-23. Status: accepted. Decider: owner, chat 2026-10-23.

Question: which operational tasks are appropriate before a new deployment exists
and while the database may change? The owner said SPN-062 need not exist because
there is no current deployment, and requested moving SPN-063 into launch work.

Retire SPN-062 rather than publishing its prepared monthly host-patching runbook
or pretending an existing server needs maintenance. Remove its dependency and
obsolete routine reference from SPN-038. This is cancellation, not implementation
completion, so do not add SPN-062 to the grooming completion list. Local draft
material is retained as preparation only and is not merged by this change.

Keep SPN-100's repository updater configuration as an independent, small task:
npm dependencies, pinned images and Actions exist even without a live server.
Its configuration review remains required. After merge, inspect the real hosted
updater result and any generated PR, without claiming the removed live-host
runbook or forcing a synthetic dependency update. This revises the earlier split;
SPN-062 is no longer a downstream acceptance gate.

Move SPN-063 to the launch phase, keeping its complete recovery and cleanup
acceptance. Implement against the database and hosting chosen for launch, without
building a speculative multi-backend verifier now. Public HTTPS remains the final
launch milestone; this change grants no deployment, spending or DNS authorization.
SPN-038 explicitly depends on SPN-063 so the generated launch order preserves
that final milestone. Deployment/database selection can be prepared during
launch planning; recovery verification precedes public exposure.

Persona effects: Operator avoids maintaining a nonexistent host or a soon-replaced
database verifier. Owner and Collaborator retain recovery guarantees for the
selected launch system and reviewed repository updates. Link guest's access
boundaries and recovery isolation remain unchanged. This is focused maintenance;
preserve the grooming date and completion history.

## Link migrated decisions from their original issues

Date: 2026-10-23. Status: accepted. Decider: owner, chat 2026-10-23.

The owner reaffirmed moving legacy decision issues into repository documentation
under the new implementation-record standard, and explicitly requested comments
on the old issues after merge. Extend SPN-096's acceptance with that final step.

Preserve the original issue and chronology, map every migrated decision to one
canonical file/heading, and wait for the migration PR's verified merge SHA before
posting its backlink. Use immutable `blob/<merged-sha>/<path>#<heading>` links,
check for an existing matching comment, and retain a comment-URL inventory so a
partial failure can be resumed without duplicate posts. No comment is posted by
this grooming change, and no record or migration is claimed complete here.

All personas retain the original constraints and status: Operator can trace
operational decisions, Owner can locate product authority, Collaborator keeps
sharing and data-integrity guarantees, and Link guest retains access/privacy
boundaries. Linking existing decisions changes no product behavior or approval.

## Related owner priorities and palette review

The owner's high-impact request for SPN-097 is recorded in its
[canonical decision](SPN-097.md#raise-pdf-feasibility-impact); effort and evidence
requirements remain unchanged. SPN-088's possible redundancy was checked against
source, public APIs and actual Sheet/Doc light/dark captures. Independent
all-persona review supported [retiring the additional eight-choice proposal](SPN-088.md#retain-native-colors-and-retire-the-extra-palette-proposal),
while preserving existing native rendering and legacy stored formatting. Neither
SPN-062 nor SPN-088 is counted as a completed implementation.
