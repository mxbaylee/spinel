# Personal pins

Everyday users can pin documents and folders they can currently open, including
view-only shares. The sidebar is available on the dashboard, folders, trash,
Settings and open editors. A pin is a personal shortcut: it does not move the
owner's item, change access, modify contents, or update shared history/timestamps.
Administrators and unauthenticated guests have no pins API or workspace sidebar.

New pins append; pinning an already-pinned item leaves its order unchanged.
Drag a handle onto another pinned row to move it to that position, or use the
Up/Down buttons with keyboard or touch. Order persists in SQLite per user.
The Shared badge identifies references owned by another person. Personal tags
appear on pinned documents too. Shared-with-me filing and owner attribution
remain in SPN-018.

Unpinning removes only your reference. Trashing an item/subtree or losing its
last effective grant removes affected pins in the same transaction. Inherited
access and moves are included; an alternative direct/folder grant retains a pin.
Restoring/regranting does not silently pin it again. Hard deletion cascades.
Lists also recheck current access. Open pages refresh on focus, return to the
foreground and every 15 seconds while visible; ordinary local mutations refresh
immediately. Navigating a pin still uses the document's current access check and
the existing unsaved-work guard.

`GET /api/items/pins` returns `{ items }` in personal order. `POST` and `DELETE`
on that path take `{ id }` to add/remove a reference. `PUT` takes `{ ids }`, an
exact permutation of the currently accessible pins. Duplicate/malformed IDs are
400; a stale set is 409 so another tab's added pin cannot be lost. Mutations
return the authoritative ordered list and use the existing session, JSON and
Origin protections. The UI serializes mutations and ignores older list responses.
Failures show a refresh/retry path rather than silently claiming a new order.

This preserves the Owner's daily shortcuts and Collaborator's personal
organization, gives the Operator a small additive schema with foreign-key cleanup,
and keeps Link guests outside personal metadata. [Decision #64](https://github.com/mxbaylee/spinel/issues/64), 2026-10-18.
