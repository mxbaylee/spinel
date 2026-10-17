# Personas

Who Spinel is for. Ticket stories link one of these headings. Decisions weigh all
of them, not only the one a ticket is for. Edit this file as we learn more; a
renamed heading breaks ticket links, and the backlog checker will say which.

Using Spinel on a phone, as an installed PWA, is a job each persona can have,
not a persona of its own.

## Operator

The person who runs the instance: @mxbaylee, wearing the admin hat.

- Sets up the server, keeps it patched, backed up and private.
- Invites people, revokes access, and sees who has which devices.
- Notices problems (disk, memory, a stuck connection) before they lose work.
- Wants: few moving parts on a 2 GB droplet, nothing exposed beyond Tailscale,
  and recovery that has been tried, not just written down.

## Owner

The daily driver. Owns most documents and lives in the dashboard.

- Keeps budgets, journals, recipes and plans in Sheets, Docs and Slides.
- Finds things fast through folders, tags, pins and search.
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
