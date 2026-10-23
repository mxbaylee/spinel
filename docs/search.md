# Dashboard search

Use **Search files** to find items across your own folders and everything shared
with your account, including folders. Search matches titles, visible folder paths
and your personal tags as you type. Words combine: `budget planning` must match
both words somewhere in those fields. Matching ignores case and normalizes Unicode
compatibility forms. It never searches document contents.

Use **Search options** for search words, **File type**, **Ownership** (Mine or
Shared with me), **Tag** and **Last modified**. The same field also accepts optional
qualifiers such as `type:sheet owner:shared tag:"summer travel" modified:week`.
Each labelled filter chip removes only its own filter. Quote literal qualifier
words, for example `"type:sheet"`, to search for that text. Unknown colon words
such as URLs stay literal. Every selected filter must match. Tag is an exact personal
label match, ignoring case and accepting an optional leading `#`; general search
also matches displayed `#tag` text. Last modified means the past 24 hours, 7 days
or 30 days measured from the current time, including the boundary. Tag and personal
filing changes do not change document modification time. Results are newest
modified first, then stable item ID for ties.

Incomplete, duplicate or invalid qualifiers pause results and requests while the
draft stays editable; chips identify the last valid filters. **Search this as
plain text** treats the whole draft as search words while retaining those filters
and the current scope. It is disabled above 200 literal characters instead of
truncating text. Clear remains available. Search help is available by keyboard
and touch. See the [draft/recovery decision](implementation/SPN-048.md#unified-search-draft-and-recovery)
and the still-pending [scope integration contract](implementation/SPN-048.md#scope-and-return-context).

**Clear search and filters** returns to the current folder or editor. Searching
hides the open editor without unmounting it, so unsaved changes stay in place.
Opening another result uses the ordinary unsaved-change confirmation. Cancelling
that confirmation keeps both the search and the current editor's work.

## Personal filing and access

Shared results reuse the shared catalog's owner labels, current role and personal
placement metadata. They match only folder names the caller may see, including
personal filing destinations and descendants of a filed shared folder. A directly
shared document cannot reveal its owner's private ancestors. Personal references
produce one result per source item; filing never moves the owner's document.
Only the caller's tags participate, never another person's labels.

Loaded metadata filters immediately; a debounced server query supplies the complete
currently permitted catalog. Results refresh on window focus, becoming visible
and every 15 seconds while searching. A failed server query hides results and
provides Retry search. Opening a result and every content request still enforce
current access, regardless of the visible search results.

`GET /api/items/search` accepts only `q`, `type`, `owner`, `tag` and `modified`.
Unknown fields, repeated parameters, unsupported filter values and oversized input
return 400. The query is bounded to 200 characters and other fields to 100.
Responses use `Cache-Control: no-store`. The server resolves the active everyday
account, excludes trash and rechecks item access before projecting paths and
filtering. Administrators, disabled accounts and link guests cannot use search.
No document snapshots or content index are loaded by this query.

These rules retain SPN-022's title/path/tag scope and split client/server filtering
(PRD §2.2; grooming 2026-10-17). Sharing decisions [#72](implementation/SPN-016.md#legacy-decision-72-scoped-anonymous-link-capabilities)/[#74](implementation/SPN-018.md#legacy-decision-74-personal-filing-of-shared-items) and grooming 2026-10-18
supply the personal-path and privacy constraints.
[Decision #79](implementation/SPN-022.md#legacy-decision-79-authorized-metadata-search) chooses predictable
metadata matching for the Owner and Collaborator, no extra indexing service for
the Operator, and unchanged document-scoped access for the Link guest.
