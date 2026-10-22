# Personas

Who Spinel is for. Ticket stories link one of these headings. Decisions weigh all
of them, not only the one a ticket is for. Edit this file as we learn more; a
renamed heading breaks ticket links, and the backlog checker will say which.

Using Spinel on a phone, as an installed PWA, is a job each persona can have,
not a persona of its own.

## Operator

The person who runs the instance, through an admin account. @mxbaylee has one
admin account for running Spinel and a separate everyday account as the Owner.
Admin accounts can't view, edit or create documents.

- Sets up the server, keeps it patched, backed up and private.
- Invites people, revokes access, and sees who has which devices, without
  ever seeing anyone's documents.
- Notices problems (disk, memory, a stuck connection) before they lose work.
- Wants: few moving parts on a 2 GB droplet, private database and management
  access, and recovery that has been tried, not just written down.
- The accepted test deployment was tailnet-only and has been retired. The Owner
  chose public app HTTPS with private management for the later SPN-038 redeployment;
  its timing and internet-facing acceptance remain pending (decision #40).
- Production begins with SPN-038 at `spinel.baylee.dev`, the last launch
  prerequisite; optional CSV import (SPN-093) and document/format plugins (SPN-094) follow launch.
  Before that, database choices can change without a live-production migration;
  keep operations simple and preserve any deliberately retained test data.
  Owner, chat 2026-10-21.

## Owner

The daily driver. Owns most documents and lives in the dashboard.

- Keeps budgets, journals, recipes and plans in Sheets and Docs.
- Finds things fast through folders, tags and search.
- Needs nothing to be lost: trash that can be undone, history that can be
  restored, edits that never silently vanish.
- Wants it to feel like Spinel, not a generic office suite.

## Collaborator

An invited person with their own account and passkey, who edits alongside the
Owner.

- Opens what was shared with them and files it into their own folders.
- Edits at the same time as the Owner and sees where they are working.
- Needs to know clearly what they can and can't change, and why something is
  read-only or waiting.
- Doesn't own the documents they work in, and must not be able to lose them.

## Link guest

Someone with a share link and no account.

- Opens one document from a link, on whatever device they have.
- Can view, or edit if the link allows it, and nothing else on the instance.
- Never sees the dashboard, other documents or other people's details.
- Must lose access the moment the link is turned off.
