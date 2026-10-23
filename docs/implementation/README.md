# Implementation and decision records

New decisions live beside the implementation notes in `SPN-NNN.md`, even before
implementation starts. This replaces opening GitHub decision issues for new work.
Owner, chat 2026-10-22. SPN-096 migrates older issues; their existing citations stay
valid until a faithful replacement exists.

After a legacy migration merges, comment on each original decision issue with
its canonical file and heading at the verified merged commit SHA, retaining the
old discussion and checking for duplicate backlinks first. SPN-096 tracks these
post-merge comments and their URLs. Owner, chat 2026-10-23.

Use one file per ticket. Extend existing notes without replacing their contract,
verification or history. Link a decision's heading from the ticket's Rules and
from the maintained product/design/process document where it applies. Records
remain after the ticket is deleted. Cross-ticket policies with no single owning
ticket use a descriptive dated file, for example `grooming-2026-10-22.md`; related
tickets link to the same canonical decision instead of copying it.

For each consequential choice, record:

- A descriptive heading (stable link target), date and status: proposed,
  needs-owner, accepted, rejected or superseded.
- The question, relevant evidence/context, options and tradeoff.
- The chosen outcome and why, or the unresolved owner question and work that can proceed.
- Owner, Collaborator, Link guest and Operator effects; explicitly say when a
  persona is unaffected rather than inventing an impact.
- Who decided and the source: owner chat/date, PR/comment link, or agent judgment.
  Link source issues for migrated decisions and link any superseding entry.

A record is not approval by itself. Ask the owner when required, leave its status
truthful, and update `owner_input` on the active ticket while waiting. Once settled,
update the ticket Rules and the relevant maintained docs. Keep routine code notes
brief; do not turn this into a transcript or another general documentation system.
Legacy `decisions: [123]` frontmatter remains an issue-number list during migration;
new records are ordinary Markdown links, not fabricated issue numbers.
