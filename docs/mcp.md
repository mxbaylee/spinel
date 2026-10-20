# External assistants over MCP

Spinel has no built-in AI. An assistant you choose can connect to the instance's
`/mcp` endpoint using Streamable HTTP and a personal bearer token. The assistant
runs outside Spinel; connect only a client you trust with the documents your
account can access. This is optional. No model, API key or assistant service is
configured on the Spinel server.

## Connect and revoke

In **Settings → Assistant access tokens**, name a token and choose **Create access token**.
Copy it immediately: leaving or reloading the page loses the only displayed
copy. Spinel stores its SHA-256 hash, never the secret. The panel displays the
MCP endpoint URL. Configure a client that supports custom HTTP headers with:

```text
URL: https://<your-instance>/mcp
Authorization: Bearer <your-token>
```

Use the instance's HTTPS address outside local development. Tokens are supplied
only in the Authorization header, never URL query parameters. Client-specific
configuration varies; a client requiring OAuth discovery without custom headers
is not supported by this personal-token interface.

Tokens carry the account's **current** document permissions, including inherited
sharing grants. Viewers can read, editors can edit, and only documents visible to
that account appear. A token cannot administer accounts, change sharing, create
items, call native file APIs, or become a browser session. Admins and Link guests
cannot create or use these tokens. Admins see names, account names, creation/last
use and revoked state, never secrets or document contents.

**Revoke** stops further requests immediately, including an admitted mutation
that has not reached its durable commit. Disabling an account has the same effect.
Tokens do not expire automatically; revoke them when no longer needed or if exposed.
There are at most ten active tokens per account. Revocation cannot recall data an
assistant has already read. Signing out of the browser does not revoke tokens.

## Tools

- `list_documents`: accessible Sheets and Docs in pages of 100; pass `next` as
  `after` for the following page. Returns item ID, name, type and access.
- `read_sheet`: worksheet names/dimensions plus a rectangle of values, formulas
  and cell rich text. Coordinates are zero-based. Defaults to the first worksheet,
  20 rows and 10 columns; at most 1000 cells and 256 KiB per result. Request a
  smaller rectangle if the result is too large.
- `read_doc`: body text in pages of at most 20,000 UTF-16 code units. Offset and
  returned `next` refer to that body, including paragraph and structural markers.
  The final document terminator is excluded. Formatting, image URLs, history and
  arbitrary plugin resources are not returned.
- `edit_sheet`: set up to 100 literal cell values (text, number, boolean or null
  to clear). Existing formulas/rich text in those cells are replaced, unrelated
  styles and cells stay intact. Formula creation and formatting are not exposed.
- `edit_doc`: insert/replace up to 10,000 UTF-16 code units at an offset. Newlines
  insert paragraphs. Edits preserve unrelated content and formatting through
  Univer's public text mutation. They cannot delete the final terminator,
  split a surrogate pair, or remove table/image/other structural markers.

Read before editing. Both edit tools require the returned `unitId` and `revision`
and a new UUID `requestId`. An intervening edit, history restore or permission
change refuses a stale write. Read the latest content and make a new intentional
edit with a new request ID. For a lost response, retry the **identical** original
arguments and request ID; the SDK's durable identity prevents a second application.
Reusing an ID with different content is refused. Payload fingerprints persist for
30 days; an older retry cannot reapply against its obsolete revision, though it
may no longer recover a successful response after history pruning.

## Implementation and limits

`src/server/mcp/` uses the official `@modelcontextprotocol/sdk` 1.32.1 with a
stateless Streamable HTTP transport and JSON responses. One message per POST;
GET and DELETE return 405 after authentication. Every request reauthenticates;
cookies and query tokens do not grant MCP access. A present Origin must match
`APP_ORIGIN`. No browser CORS access, background subscriptions or MCP sessions.
The SDK handles protocol negotiation and JSON-RPC validation. Errors do not
include token hashes, SQL or inaccessible document metadata.

Two requests can run at once, with 96 KiB request bodies and 64 KiB mutation
payloads. Admission remains occupied until asynchronous work settles, including
when a caller disconnects. Reads use the current materializer; writes submit
normal changesets through `CollaborationStore`, including its session/grant checks,
image and size validation, restore fencing, history and live editor broadcasts.
MCP adds token validation and exact-base validation at commit; it never replaces a
live snapshot or modifies a Pro package. Request fingerprints are capped at
100,000 recent writes across the instance; reaching that cap refuses new writes
rather than growing without bound.

Settings and admin controls reuse existing card/list and once-only secret reveal
patterns. Their stories cover loading, empty, busy, failure, reveal, copy fallback
and revoked states. Regression tests exercise hashing, scope, token/account/grant
revocation during writes, read revocation, stale generations/revisions, durable
retries, and an official SDK client reading and editing both document types.

Decision [#111](https://github.com/mxbaylee/spinel/issues/111), 2026-10-20, weighs
all four personas and keeps the interface small and the existing access boundary
intact. It resolves the timing from [#41](https://github.com/mxbaylee/spinel/issues/41)
and follows the live-write constraints from
[#92](https://github.com/mxbaylee/spinel/issues/92).

Primary references: [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
and the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).
