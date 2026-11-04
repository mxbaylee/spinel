# 🔎 SPN-141 Safari evidence review

Independent nonimplementing reviewer B; agent review only. Safari evidence is accepted for this owner. This is not overall PR merge approval and does not validate SPN-140 or SPN-120.

## 📌 Exact identities

- Source: `2f1c9304b15adfef833e53f12c4facff9ce14821`; base: `5d8676ec280ac6d5cc9dcedb7e9cc09527b24806`.
- Tested merge: `a554c611c96556176bcc6b2ba006ea421ee00943`. Independently resolved both source/tested trees as `faac771987098438ff4f9269ef27d20a1a2bb7e2`.
- Run `41885019409`, attempt 1, Safari job `126767084191`, artifact `13350718865`.
- Independently recomputed Safari ZIP SHA-256: `80068fda84c5b59a0afe32efe187189104b304d2ca90bcad583b3ae590f86e01`.
- Retained CI plan identifies this source/base/tested merge, PR opened event and full selection. This review does not claim other jobs passed.

## ✅ Capability and application evidence

Safari 27.2 on macOS 15.7.9 Intel, image `20260824.0482.1`. Capability identities established for PIDs 2135/2374 in 1209/171 ms. Both online and offline baseline helpers contain the correct probe title, positive 1324×940 native window bounds, complete/visible/focused page state, screenshot and expected purple/blue Canvas2D readback. Both actual PNGs were visually inspected and show the SVG and canvas content. LocalStorage, IndexedDB and cache retain the same sentinel; the worker remains active after offline restart. No capability teardown error is recorded.

One initial System Events prompt-inspection command timed out after about 10 seconds with SIGTERM. It remains visible in raw evidence. The next inspection recognized the normal consent dialog and approved it while the single initial Safari title request stayed pending; that request succeeded. This is a retained prompt-inspection diagnostic, not evidence of repeating a failed Safari action. SPN-140's constructor recovery is absent from this source, so this pass neither proves that recovery nor erases the earlier constructor failure.

Application records cover all four Sheet/Doc normal/conflict cases, full original-record retention, native offline edits, a second offline restart retaining pending checkpoints and images, exact-content normal reconnect with revision 2 and no second commit after reopening, and two recovery copies preserving their originals and receipts through reconnect. I traced these recorded stages to the source assertions for complete record/checkpoint equality, image rows, expected content, copy ownership and receipt stability. Raw stages retain hashes and results rather than every compared snapshot; I did not claim to reconstruct missing snapshots independently. Independently recomputed all 12 retained image-byte hashes successfully.

Five pointer journal entries all record delivered trusted target clicks, matching before/after browser PIDs and one two-event click post. Ten render journal entries retain native target and page state. Inspected all 13 supplied PNGs: the normal/conflict offline and recovered-copy screenshots visibly show the synthetic `731` Sheet edit and `Desktop offline 731` Doc text with fixture images.

## 🧽 Storage preparation and cleanup

All-browser inventories before unregistration and after restart each report only `https://localhost:8176/_desktop-storage-loss`, unchanged before/after inventory. This real execution contains one tab; multi-tab and malformed-inventory behavior is covered by the reviewed deterministic controls, not demonstrated by this native run.

The preparation record verifies the inert marker and zero scripts, unregisters the one origin worker once, and observes no remaining registrations. The old controller still exists at that stage as expected. PID 7488 then exits. Same-profile PID 10924 starts; read-only inventory remains inert and deletion preconditions observe both no registrations and a null controller. One shell-cache deletion returns true; localStorage is cleared and the targeted private database is deleted. Strict verification observes zero workers, zero cache names, zero localStorage entries and absence of the targeted private database. `UniverLocalStorage` and `spinel-offline-runtime` remain intentionally outside that targeted database contract.

After loss, account is null and available count zero. A subsequent transport outage presents the connection-required offline message, without an offline-save claim or editor canvas. Application launches are PIDs 3635 → 6086 → 7488 → 10924, all with the same ordinary hosted profile path/device/inode. Each PID has a recorded exit, including final cleanup; no browser or fixture teardown error is recorded. Final transport has no active browser sockets. These are owned-process witnesses, not a system-wide absence claim.

## 🖼️ Publication and limits

All 13 PNGs show synthetic fixture content and disposable hosted-runner UI; no personal browsing, credentials or user documents were observed. JSON/JSONL inspection found no credential-bearing fields. Useful visible publication examples are `safari/sheet-normal-offline.png`, `safari/doc-normal-offline.png`, `safari/sheet-recovered-copy.png` and `safari/doc-recovered-copy.png`; the offline capability baseline can supplement them. Other captures are supplementary and need not all be embedded. Images alone do not prove byte retention, authority, receipts or deletion; raw records and source assertions provide that evidence.

No new Safari blocker found. Preserve this owner result and the prompt-inspection timeout accurately. Chrome, Firefox, remaining current-head gates, maintained final evidence and overall acceptance must be assessed separately before merge.
