# Personal document tags

Use **Tags …** beside a document in the dashboard or its open-editor heading.
Add a name, choose a previously used name from the input suggestions, or remove
one of the document's labels. Tags also appear in folder listings and trash.
They are personal: a collaborator sees only their own labels and suggestions,
including when they have view-only access to the document.

Names are trimmed, one optional leading `#` is removed, and Unicode is normalized
to NFC and lower-case. Names must contain 1–64 UTF-16 code units after normalization
and cannot contain control characters, unpaired surrogates or another leading `#`.
This keeps saved names stable when reused or removed. The display adds
`#`; it is not required when typing. Duplicate additions and repeated removals
are harmless. Folders are not tagged. The dashboard [search](search.md) combines your tag filter
with title, path, type, ownership and modification filters.

A person's vocabulary retains names they previously used even when no current
document has that tag. Removing an assignment does not delete that suggestion.
Suggestions are not derived from other people's tags or document contents.
Personal tag changes do not alter the document's content, modification time,
ownership, grants or history. Separate add/remove operations avoid overwriting
another tab's unrelated tag changes.

Each assignment change requires a current everyday-account session and current
read access to that document. Viewers can organize their own references without
gaining content-edit permission. Revoked or disabled accounts cannot change tags;
Operator and anonymous accounts cannot use these endpoints. Trash retains tag
assignments for restoration; permanent document deletion cascades assignments.
Vocabulary remains private to the person for reuse. These tables live in the
application SQLite database and therefore join its consistent encrypted backups.

`GET /api/items/tags` returns the requesting person's vocabulary. Authenticated
item/list/trash responses include that person's `tags` array. `POST` and `DELETE`
`/api/items/:id/tags` accept only `{tag}`; both require the configured Origin and
JSON, resolve current access, and return the updated item. User identity comes
from the session, never the payload. No guest-link tag endpoint is added.

Decision #62 records the tradeoff: reusable organization for the Owner,
independent personal labels for the Collaborator, simple bounded-name storage
for the Operator, and no account metadata exposure for the Link guest.
