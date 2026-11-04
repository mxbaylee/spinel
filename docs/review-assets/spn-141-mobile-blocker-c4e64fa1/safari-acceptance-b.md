# 🔎 SPN-141 Safari acceptance review B

Independent nonimplementing review, 2026-11-04. **Safari's current-source native acceptance is supported, with no new blocker found in this owner.** This is not approval of the entire PR or a statement that Chrome/ordinary CI is complete. No source edits, browser execution or heavy workload; inspection used retained JSON, source assertions, logs, image bytes and selected screenshots.

## 📌 Immutable identity and integrity

Source `c4e64fa110a57d70fb682649d7f4d45ca3d20951`; tested merge `4be35332dda5e805c7fd8c45d69099b535c3000f`; independently verified identical tree `fa97144469a2a600ff304d38c9747af724d71807`. Native run `41903959769`, attempt 1, Safari job `126833486287`, artifact `13359163780`. ZIP SHA-256 independently matches `276e79e110ef98aff86da51fd265f4205dbea8c509b642214c64f612e9fdffe1`; all 18 ZIP members pass CRC and match the extracted files byte-for-byte. Capability and application records identify this source/tested pair and run.

Environment is actual ordinary-profile Safari 27.2 on macOS 15.7.9, Intel hosted runner `macos-15-intel`. This is neither WebKit emulation nor a private automation profile.

## 🧪 Capability and complete application contracts

The separate capability probe established Safari process identities for PID 2396 online and PID 2623 after offline restart (255/135 ms). Retained localStorage, IndexedDB and CacheStorage contain the same synthetic token and a controlling worker is present. Both online/offline paint baselines contain complete, visible, focused pages, available default Canvas 2D contexts, completed drawing and expected opaque purple/blue readback after physical capture. I viewed both baseline PNGs; SVG and canvas color fields and labels are visibly rendered. This checks the actual baselines rather than relying only on top-level `passed`.

Normal ephemeral-runner automation consent was recorded. The first prompt-inspection operation timed out with SIGTERM; the subsequent recognized-dialog inspection/capture/approval succeeded while title request 1 was still pending. That same request returned the expected title; no failed-title replacement or constructor failure appears here. Keep that diagnostic in the archive. Automation log collection reports complete source acquisition but deliberately bounded retention: 447 matched lines, 344 retained, 103 omitted, 65404 retained bytes, `truncated: true`. Do not describe retained system logs as exhaustive.

Application evidence includes all four sheet/doc normal/conflict downloads, original exact-record retention across an offline process restart, actual native edits, and pending-checkpoint retention across a second restart. Source assertions compare complete records and reconstructed content, not only UI labels. Retained clipboard observations show `731` for both sheets and `Desktop offline 731 Recovery base notes` for both documents; both document selections cover logical/native range 0–40 without pending selection. Four checkpoint hashes and three image hashes per item are retained.

Both normal reconnect paths reached revision 2, exact expected snapshots/images and a clean outbox; reopening did not recommit. Both conflict paths preserved the remotely changed original and published distinct copies with exact offline content, correctly rewritten image sources, actor ownership and unchanged receipt identities across subsequent outages/reopens. The final receipt count is two. I independently hashed every retained image byte row in the two normal and two conflict records: each set has three PNGs and every SHA-256 matches its image ID. Five native pointer records report trusted target mousedown delivery and observer removal; all ten render-state records have complete pages. These are supported by the corresponding assertion ordering in the exact source.

## 🧽 New handoff, strict deletion and cleanup

The observed inventory contains one fixture tab; this run does not independently exercise a multi-tab restoration case (focused controls cover that branch). Unregistration returned true, with empty registrations but a surviving controller at 20:18:09.832Z. At 20:18:10.345Z the explicit handoff records the distinct query URL, `fresh: true`, complete/inert document, zero scripts and null controller. At 20:18:10.471Z the separate pre-stop verification observed zero registrations and null controller without deleting any store.

PID 7349 exited at 20:18:11.178Z. PID 10325 restarted in the same ordinary profile. The unchanged post-restart precondition independently found zero registrations and null controller at 20:18:15.886Z, before mutation. Exactly one shell-cache deletion and one targeted account-database deletion followed. Final state at 20:18:15.907Z has no registrations/caches, zero localStorage entries and no targeted database. `UniverLocalStorage` and `spinel-offline-runtime` remain legitimate out-of-target diagnostic context.

After returning online, the catalog supplied names but reported account null and zero available copies. The subsequent disconnected navigation displayed the offline connection requirement, no saved-device claim and no editor canvas under the source assertions. Completion was recorded, then final browser exit was witnessed.

All four application launches use Safari 27.2 and the same ordinary `/Users/runner` profile device/inode (`16777221`/`12884922560`): PIDs 3635 → 5832 → 7349 → 10325. Each has a matching witnessed exit; predecessor identities chain correctly. Offline boundaries report zero active browser sockets, one login and blocked traffic. No browser or fixture teardown-error field is present, and the final report remains passed. This establishes the harness's owned cleanup contract, not system-wide process absence.

## 🖼️ Publication and disposition

Viewed useful `sheet-normal-offline.png` and `doc-recovered-copy.png` plus both capability baseline PNGs. They show synthetic localhost content, the visible 731 edit, colored image rendering and the recovered-copy title/content, with no visible credentials or real-user material. These four are suitable representative evidence with exact source/environment captions; remaining captures can stay supplementary. JSON identities, local runner paths and synthetic recovery UUIDs are diagnostic fixture data. Screenshots complement exact content/image assertions and do not alone prove storage state.

This first-attempt repair success supports the new client-release boundary for the observed Safari scenario. It does not establish Safari's internal persistence root cause, guarantee arbitrary future lifecycle behavior, or erase the integrated-source failure archived at `f8e24b41b73eb9d4414597aba2c3396a931a9408`. Preserve that failure and the original Firefox failure. Current-source Firefox acceptance was reported separately and is outside this review; Chrome and remaining selected gates must receive their own completed evidence before merge readiness is claimed.
