# Offline SDK integration probe — in progress

This is the first bounded investigation for [SPN-039](todo/SPN-039.md), not an
offline feature or acceptance claim. The full [contract](offline.md) remains open.

`e2e/offline-probe.spec.ts` runs against the loopback HTTPS production fixture
with pinned Univer 1.1.0 and Playwright Chromium. It prepares one fresh owned
Sheet or Doc, records its authorized read responses in the test process, then
disconnects HTTP and WebSockets. It commits an edit, closes the entire persistent
browser, opens the same profile offline, commits a second edit and closes/reopens
again. Finally it reconnects, reloads and compares exact content through an
independent authenticated HTTP client that bypasses the browser's fixture cache.

The response fixture stands in for a future local read adapter. It deliberately
includes this synthetic account's bootstrap metadata and permission responses;
production must use the explicit account-scoped store and access lifecycle in
the contract, never cache credentials/authentication responses. Only successful
allowlisted reads/preparation for this one unit are recorded. Session tickets,
write acknowledgements, licensing responses and other origins are not replayed.
The test does not replace document snapshots or pending operations. The SDK's
existing recovery store must survive real browser shutdown and replay normally.

The exact baseline revision is also prepared because the public DataLoaderService
loads pending edits from their cached revision. The fresh fixture has no restored
generation offset. A five-second settling period observes existing SDK behavior;
it is not a durable-save signal or a product guarantee. Unique clipboard sentinels
require fresh copies, and final server reads prevent a local-only false pass.

Run after `npm run build`, with only one guarded local workload, or use the
owner-approved CI-first path when local memory pressure prevents safe testing:

```sh
SPINEL_E2E_PROJECT=mobile-https npx playwright test --project=mobile-https e2e/offline-probe.spec.ts
```

Each scenario logs its last stage, missing fixture reads and response count, and
saves a screenshot. There are no retries. A failed stage is integration evidence,
not grounds to close the ticket. The initial text-only probe must be extended to
existing images, concurrent peers, lost acknowledgements and the remaining
storage/access lifecycle. Actual Android and iPhone installed-app evidence is
still required. No device/offline result has yet been recorded.

## Initial fixture diagnosis

CI 39196316063 on `25366cd` passed 228 unit tests and the 54 desktop browser
tests, but the Sheet probe failed before its first online saved state. It recorded
19 fixture responses and no cache misses; the Doc probe and PWA case were stopped
by the configured first-failure limit. This is not cold-start evidence.

A separate guarded HTTPS/WebSocket echo fixture reproduced Chromium's
`ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` when its HTML was fulfilled by
Playwright. Granting `local-network-access` only to that loopback origin made the
same test connect, with its original cookie and Origin present. The SDK probe now
grants that test-only permission on every browser launch. It also lets online
non-fixture requests use the normal browser path and records sanitized connection
errors. Application authentication and explicit offline blocking are unchanged.
The revised SDK probe must still run; the echo result alone proves no SDK behavior.
The permission API is documented in
[Playwright's browser context reference](https://playwright.dev/docs/api/class-browsercontext#browser-context-grant-permissions).
