# Storybook follows production

## Migrate stories with their UI tickets

**Accepted — owner, chat 2026-10-27.** The Storybook walkthrough still showed
SPN-047 mock headers after production gained rename and appearance controls.
Labelling that mismatch was insufficient: the owner wants completed designs
moved into production stories, with the last migration removing Redesign.

Keep one authoritative story set for shipped UI, rendering the production
component with local API fixtures where needed. Do not rename an old mockup to
claim production parity or maintain a second implementation of its controls.
Native SDK regression fixtures remain explicitly separate from app screens.
Only unfinished examples with a specific open ticket may remain under Redesign;
put that ticket ID in the story title and link its story from the ticket. Every UI
ticket replaces or retires its owned design examples as it lands and covers new
states using production components. If no open ticket owns an old design
example, inspect its current replacement and retire the obsolete duplicate now.

The ticket removing the final Redesign example also removes the remaining group
ordering/reference and obsolete catalog instructions. The build rejects a
Redesign story without an open ticket; deleting a ticket cannot silently leave
its stale proposal behind. Historical review images stay as historical evidence.

Owner and Collaborator get previews that match the controls they will use.
Link guests get truthful permission and viewer examples. Operator examples use
production account/admin controls without granting document access; fewer
parallel mock implementations also reduce maintenance. Existing production
interaction tests and independent light/dark/phone review remain required.

## Completed Redesign migration

- **SPN-066:** production `GuestLinks` and integrated `ProfilePage` stories
  replace `redesign-spn-066-guest-links--preview`. The final Redesign group and
  its current catalog instructions are removed. Historical captures retain
  their original provenance.
- **SPN-055 has landed** in `2361a23`: production `DeviceStoragePanel` and its
  stories replace the former This device proposal; no pending example remains.
- Other open UI tickets have no retained legacy story. Add or update production
  stories for their actual states; do not keep unrelated old screens under them.

## Retired and retained coverage

The old connected Walkthrough and generic Screens are retired. Production
Dashboard, EditorFrame, Space, ProfilePage, GuestApp, AuthEntry and AdminPage
stories cover their corresponding shipped components. Real application browser
journeys cover their routing, native editors and persistence.

Production stories replace the old file dialogs/mutations/recovery, sharing,
history/version names, formula authoring, profile/icon picker, authentication,
admin/account actions, connections/tokens, tags, presence and import specimens.
Unowned loading proposals are retired. SPN-087 removes obsolete fixture CSS and
source later; it is not a blanket owner for obsolete visible stories. SPN-089
checks production dialogs and their actual stories.

Appearance, shared Controls and Theme control already render shipped components
and move into Current production with their existing IDs retained. Native
editors remain under Native fixtures with their keyboard, viewer, snapshot and
native-menu regression checks. Their isolated SDK setup is not the production
Doc mobile wrapper. Retired-only mock walkthrough assertions and old
before/proposed report sections are removed; surviving production and native
checks remain.
