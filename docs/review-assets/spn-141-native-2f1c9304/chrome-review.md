# ✅ SPN-141 Chrome acceptance review

Independent nonimplementing reviewer A; agent review only. Chrome-owner acceptance is supported, with no findings. This is not overall merge approval; Firefox and the complete required gate set remain separate obligations.

## 🔎 Identity and provenance

- Source `2f1c9304b15adfef833e53f12c4facff9ce14821`; tested merge `a554c611c96556176bcc6b2ba006ea421ee00943`; base `5d8676ec280ac6d5cc9dcedb7e9cc09527b24806`. Independently resolved both source and tested trees as `faac771987098438ff4f9269ef27d20a1a2bb7e2`.
- Run `41885019409`, attempt 1, Chrome job `126767084103`; supplied artifact ID `13351353246`. Recomputed ZIP SHA-256: `b07868b0caba146d0c9cf603e829d8b11fe88965a257c012d71333b1f81d1f0d`, matching supplied artifact identity. Acceptance JSON source/tested/run/attempt match.
- Chrome 157.0.8103.39, ChromeDriver 157.0.8103.38, macOS 26.6.2 arm64, runner image `20261026.0455.2`. Release record retains notarization verification. No new browser or test workload was run during review.

## 🧪 Evidence checked

Inspected acceptance JSON, versions, all four driver logs, all eight screenshots and the exact-source assertions that precede acceptance stages. Four downloads have exact image-byte hash/size comparisons; complete local records survive the first offline process restart. Offline native Sheet `731` and Doc `Desktop offline 731 ` edits survive the next process restart, including checkpoint equality and retained images. Transport counters remain unchanged at 252 forwarded requests and four forwarded upgrades throughout the offline retention/edit interval, with zero active browser sockets. Native clipboard results and screenshots independently show the edited values and painted fixture images.

Both normal reconnects record revision 2. Source assertions compare complete normalized snapshots, original image rows, clean outboxes and an unchanged server result after reopening. Both conflict outcomes preserve original server state, create distinct actor-owned copies, retain exact content and image rows, and retain exactly two receipts without duplication through another outage/reconnect. Independently recomputed all emitted image-byte SHA-256 hashes; they equal their image IDs and the retained-image hashes.

All four launches use the same explicit profile path, device `16777230`, inode `3039209`, with distinct browser PIDs 2814, 3383, 3694 and 4613. Each owned browser and driver exit is recorded, including final cleanup. The prior PID chain matches.

Before storage loss, the full tab inventories contain only the inert fixture URL. Preparation reports zero scripts, unregisters the one service worker and verifies no registrations. Its still-present controller before shutdown is explicit, not treated as quiescence. After the process boundary, the read-only inventory again contains only the inert page; deletion proves controller null and workers empty before mutations. One cache deletion, localStorage clear and targeted account database deletion all pass. Final witnesses show no cache, worker, account database or localStorage entry; the unrelated runtime/Univer database names are retained explicitly. The application then reports account null/available 0 and refuses offline opening, followed by successful owned cleanup.

## 🖼️ Useful images and privacy

All eight images contain synthetic fixture content and app chrome; no credentials, unrelated personal content or desktop surface is visible. The four normal-offline/recovered-copy Sheet/Doc images are useful representative PR evidence: they visibly show the offline values, blue/orange/green Sheet imagery, purple Doc image and published-copy state. Conflict-offline and pre-input images are consistent supporting diagnostics. These captures support rendering and data retention; they do not independently prove every data assertion or authorize a broader visual redesign.

Operator attribution and cleanup, Owner/Collaborator retained-content integrity and recovery, and unchanged Link guest authority remain consistent with the reviewed scope. Chrome acceptance is complete on the identified tree; overall SPN-141 acceptance remains conditional on other selected owners and gates.
