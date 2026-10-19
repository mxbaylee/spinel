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
