# Implementation and decision records

New decisions live beside the implementation notes in `SPN-NNN.md`, even before
implementation starts. This replaces opening GitHub decision issues for new work.
Owner, chat 2026-10-22. [SPN-096](SPN-096.md) maps the 87 inventoried legacy
decisions to canonical local entries with their original sources and chronology.
Use those entries for maintained navigation; source issues remain provenance.

After a legacy migration merges, comment on each original decision issue with
its canonical file and heading at the verified merged commit SHA, retaining the
old discussion and checking for duplicate backlinks first. SPN-096 tracks these
post-merge comments and their URLs in its migration PR audit. Until the audit
verifies every backlink, external posting remains pending even after repository
merge. Owner, chat 2026-10-23.

Use one file per ticket. Extend existing notes without replacing their contract,
verification or history. Link a decision's heading from the ticket's Rules and
from the maintained product/design/process document where it applies. Records
remain after the ticket is deleted. Cross-ticket policies with no single owning
ticket use a descriptive dated file, for example `grooming-2026-10-22.md`; related
tickets link to the same canonical decision instead of copying it.

For each consequential choice, record:

- A descriptive heading (stable link target), date and status: proposed,
  accepted, rejected or superseded (`needs-owner` is historical only).
- The question, relevant evidence/context, options and tradeoff.
- The chosen outcome and why, or a concrete unavailable execution prerequisite and work that can proceed.
- Owner, Collaborator, Link guest and Operator effects; explicitly say when a
  persona is unaffected rather than inventing an impact.
- Who decided and the source: owner chat/date, PR/comment link, or agent judgment.
  Link source issues for migrated decisions and link any superseding entry.

Agents decide using every persona under the [standing delegation](grooming-2026-10-26.md#agent-decisions-and-visual-review).
A record is not evidence that an unperformed check passed. Keep unavailable access,
physical-device verification and external-action authorization explicit in ticket
Rules and PR checkpoints; no `owner_input` field or human product/design sign-off
is required. Update the ticket Rules and maintained docs when a decision is made. Keep routine code notes
brief; do not turn this into a transcript or another general documentation system.
The CLI retains compatibility with legacy `decisions: [123]` issue-number lists
on older branches and in history. Migrated active tickets use ordinary Markdown
Rule links and an empty `decisions` list; no fabricated issue numbers are used.
