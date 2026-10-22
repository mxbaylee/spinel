# External assistants over MCP

Spinel has no built-in AI. An assistant you choose can connect to the instance's
`/mcp` endpoint using Streamable HTTP. The assistant runs outside Spinel; connect
only a client you trust with the documents your account can access. This is
optional. No model, API key or assistant service runs on the Spinel server.

## Connect and disconnect

Add `https://<your-instance>/mcp` as an MCP server in your assistant and choose
its connect action. Spinel opens in your browser. Sign in with your existing
passkey, review the assistant's supplied name, callback domain and requested
read/edit access, then choose **Allow** or **Cancel**. Spinel has not verified the
client name; only approve a request you started. Your assistant receives its
credentials automatically. You do not copy a token into the conversation.

**Settings → Connected assistants** shows the client label, callback origin,
creation time and last authenticated use. **Disconnect** immediately revokes the
connection and all its access/refresh tokens, including an admitted edit that has
not reached durable commit. Disabling the account has the same effect. At most
ten connections may be active per account. Browser sign-out does not disconnect
an approved assistant. Revocation cannot recall data already read.

Connections use the account's **current** document permissions, including
inherited sharing. Read-only scope and document viewers cannot edit; write scope
still requires the current document's editor grant. Only accessible documents
appear. Assistants cannot administer accounts, change sharing, create items,
call native file APIs or become browser sessions. Admin and Link guest accounts
cannot connect. Admins see account/client labels, callback origins, creation,
last use and revoked state, never secrets or document contents.

## Programmatic access tokens

Clients that use HTTP headers can use **Settings → Advanced: personal access
tokens**. Name a token, create it and copy the once-only secret. The card shows
the endpoint; send `Authorization: Bearer <your-token>`, never a query parameter.
Use HTTPS outside local development. These tokens carry current account grants,
store only a SHA-256 hash, and remain valid until revoked or the account is
disabled. Their custom label, creation/last-use time and **Revoke** action remain
available. There are at most ten active personal tokens per account.

## OAuth compatibility and security

Spinel implements public-client authorization code flow with S256 PKCE, OAuth
authorization-server and protected-resource discovery, dynamic client registration
and refresh rotation through the official SDK. Use clients supporting public DCR
(`token_endpoint_auth_method: none`) and a client-specific registered callback.
Registration allows HTTPS callbacks and HTTP loopback callbacks for local clients;
client metadata documents and remote logos are not fetched. DCR is retained for
client compatibility without adding outbound metadata fetching or another login
provider. The SDK does not emit `iss` on every authorization response; Spinel
does not advertise issuer-response support or support OpenAI's stable shared
callback mode. Configure a client-specific callback instead.

Authorization and every token request must bind `resource` to the exact configured
`APP_ORIGIN` plus `/mcp`. Pending requests expire after ten minutes and bind to the
browser session when reviewed. Consent requires the existing same-origin JSON
write checks. Sign-in resumes only an opaque pending request ID, never an arbitrary
return URL. Codes are hashed, single-use, expire after one minute and bind client,
callback, session, resource and PKCE. Exchange rechecks these bindings after the
SDK's asynchronous PKCE verification. Access tokens last fifteen minutes; rotating
refresh tokens last thirty days. Reusing a consumed refresh token disconnects the
entire connection. Refresh may narrow scopes, never widen them. Last use records
an authenticated MCP request, not a refresh. Registration and pending requests
are bounded at 1,000 each; unused registrations age out after a day on the next
registration. SDK endpoint rate limits also apply.

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
OAuth retries retain their connection identity across access-token refresh.
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
patterns. Consent reuses the single-purpose sign-in card and Allow/Cancel actions.
Stories cover loading, empty, busy, failure, consent, expired/session-unavailable,
reveal, copy fallback and revoked states. Regression tests exercise hashing, scope, token/account/grant
revocation during writes, read revocation, stale generations/revisions, durable
retries, and an official SDK client reading and editing both document types.

The original SPN-034 ticket explicitly described creating a personal access token
in settings. The owner revised acceptance on 2026-10-20 to a normal browser
connect/sign-in/approve flow, with connection labels and last-use metadata; personal
tokens remain an advanced option. Decision [#111](https://github.com/mxbaylee/spinel/issues/111), 2026-10-20, weighs
all four personas and keeps the interface small and the existing access boundary
intact. It resolves the timing from [#41](https://github.com/mxbaylee/spinel/issues/41)
and follows the live-write constraints from
[#92](https://github.com/mxbaylee/spinel/issues/92).

Primary references: [MCP Streamable HTTP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
, [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
and the [official TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk).

## Formula objects in Docs

[Live Doc formulas](formulas.md) are source text plus native custom-range
metadata. Read results contain no calculated source values. Plain-text edits
cannot split an object; replacing or deleting the whole expression removes
its annotation using native document operations.
