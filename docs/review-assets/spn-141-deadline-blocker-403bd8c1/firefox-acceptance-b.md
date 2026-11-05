# 🦊 SPN-141 Firefox acceptance — independent reviewer B

## Exact owner and disposition

Accepted for the **Firefox native owner only** on source `403bd8c1dfdf0b266ca93c0354abef0ef37cea64`, base `5c565b61e11ce29780581f33410749436ecef42f`, tested merge `28897ac1e143492bae980abf29f73c0e3daa8717`, equal tree `4893ed46f3c483d1da1d9e753b106af22d6cb65a`. Native run `41945378569`, attempt 1, job `126976176807`, artifact `13379020361`. No application rerun or older source acceptance was used. This is an agent review, not overall merge approval or a new source grade.

I inspected the current executed assertions in `scripts/ci/desktop-offline.ts`, the storage helpers and fixture cleanup, the report, native job log, artifact metadata, process/permission records and all nine PNGs. Supporting bounded integrity/assertion proof is `firefox-proof-b.json`, with executable audit `audit-firefox-b.ts`, `firefox-proof-first-b.log` and `firefox-proof-watchdog-b.json`. The first bounded audit passed: 16 members, 44 stages, 282 ms, sampled peak 90,704 KiB, normal pressure; no browser execution was launched.

## 🔍 Behavior and integrity

The original ZIP is 453,007 bytes with SHA-256 `461af9319067299cf3394e418467f0c5838b308deb4f325e8584fb4fd6972e68`. The independent proof verifies original ZIP identity and every extracted file byte-for-byte against its ZIP member, retaining each member's size and SHA-256. Artifact metadata binds it to this source/run/attempt; the job log binds source checkout, execution, final report and artifact upload.

Firefox 159.0.1 / geckodriver 0.37.1 ran on macOS 26.6.2 build 25G83 ARM64. Four fixtures cover normal/conflicting Sheet and Doc content. The initial permission starts unpersisted, observes the actual localhost storage prompt and allows it once; all four downloads then report granted protection. Restart launches retain persistence without another permission grant. Transport is disabled before each offline restart; active browser sockets are zero, with one login across the entire flow.

The executed harness compares complete original bundles, outboxes and image bytes before shutdown and after ordinary relaunch, then commits native offline edits (Sheet D1 `731`; Doc prefix `Desktop offline 731 `). The pending-edit restart retains all four records/checkpoints. Six native clipboard witnesses agree with the expected content; image visibility captures are single captures with positive expected color counts. The independent proof recomputes all retained committed/recovered image-byte hashes and sizes and matches them to the pending records' item-specific pointers.

Both normal items commit at revision 2 with exact expected snapshot content and clean outboxes, and reopening does not produce another commit. Both conflict paths create distinct actor-owned recovery copies, preserve original server content, rewrite only permitted identity/name/image pointers, and retain exact edited content and images. Receipts grow from one to two distinct recovery IDs, with `possible_replay_crash=0`; the source asserts no additional receipt or original change after another outage/reconnect. This acceptance relies on those actual exact-content assertions plus retained hashes, receipts and images; **the artifact does not retain full raw snapshots for a separate reviewer replay of snapshot equality**.

## 🧽 Quiescence, deletion and lifecycle

All four launches use the same explicit requested/actual profile path and the same directory device/inode. Browser PIDs are `3582 → 4151 → 4639 → 5822`, drivers `3581 → 4148 → 4638 → 5821`. Each later launch names the prior browser PID, and every browser/driver pair has a positive exit witness before the next launch (or terminal teardown). Final browser exit is `01:03:38.119Z`.

The observed storage sequence is substantive, not merely a passed flag:

- Full browser inventory contains one fixture tab, prepared at the script-free inert URL. Unregistration runs once and succeeds; registrations are empty but the old document still has the service-worker controller.
- At `01:03:30.718Z`, the explicit new-document handoff changes to `?phase=uncontrolled`. Its lost marker proves freshness; it is complete, inert, has zero scripts and a null controller. The subsequent read-only pre-stop observation confirms zero registrations and null controller.
- PID 4639/driver 4638 exit positively; the same profile restarts as PID 5822/driver 5821. Full inventory remains at that inert URL. Strict post-restart checks again find zero registrations and a null controller **before any cache/database deletion**.
- One cache deletion returns true; one deletion targets `spinel-offline-e2e6c161-a40e-4843-bbbc-f30554e7a399`. There is no repeated unregistration in the deletion phase. Each operation passed under the unchanged 28,000 ms limit. Final state has no workers, no caches, no localStorage entries and no target database. `UniverLocalStorage` and `spinel-offline-runtime` remain explicitly unrelated databases; their presence is not presented as a deletion failure or loss of user data.
- Online catalog names return, while the offline-account marker is null and available badges are zero. After a fresh worker and a new verified outage, opening the item yields the offline/connect message; the source also asserts no retained-device advertisement and zero editor canvases.

The report has no execution, browser teardown or fixture teardown error. Its final stop witness is retained. The inspected `finally` awaits fixture closure, whose shared cleanup closes transport/listener/application and closes the database in `finally`, aggregates failures, and marks the report failed if teardown rejects. The successful terminal job and report therefore support completed owned teardown. There is no claim of a system-wide process absence scan.

## 🖼️ Useful visuals and limits

All nine PNGs were visually inspected. The four useful primary captures are `sheet-normal-offline.png`, `doc-normal-offline.png`, `sheet-recovered-copy.png`, and `doc-recovered-copy.png`: light-theme 1280×604 application views show edited content, visible synthetic image blocks, offline/local status and the named saved-online recovery copies. Conflict-offline and pre-input captures supplement these rather than requiring redundant embeds. The 1024×768 permission capture shows the native Firefox localhost storage prompt and the hosted runner's desktop chrome. Visible titles, IDs and content are synthetic fixtures; no personal document, credential or private account content was observed. Raw accessibility/log records contain fixture paths, localhost URLs and browser diagnostics; the targeted credential-pattern check found no matches.

Driver logs retain local TLS-certificate-ignore warnings and WebRender GL failures with software-rendering fallback. They are not silently erased or interpreted as app assertion failures. They limit production rendering/performance extrapolation. This is explicit loss through real storage APIs, not proof of browser eviction heuristics, universal multi-tab behavior, or the precise historical Safari restoration mechanism. The actual run had one fixture tab; deterministic controls provide the additional multi-tab cases.

Earlier Firefox deletion failure, capacity-unacquired executions, Safari restoration failure, superseded incomplete coverage and responsiveness failures remain preserved in the maintained record. A new passing Firefox attempt does not retroactively waive them. No new Firefox blocker was found; other current-head native owners, all selected CI/Storybook gates, immutable evidence publication and final remote guards remain independent merge obligations.
