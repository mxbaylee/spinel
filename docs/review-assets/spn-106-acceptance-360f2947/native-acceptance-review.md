# 🍎 SPN-106 independent current-native acceptance audit

Reviewer: nonimplementing `/root/review_a`; read-only evidence audit.
Source **360f2947269309b472cce569f194994c43fa0d95**.
Tested merge **ea02b08dcbd149c5f7eae18e5cc43b9eaa48975e**.
Native desktop run **44988661516, attempt1**: https://github.com/mxbaylee/spinel/actions/runs/44988661516.

**Current required native Safari acceptance is complete. No missing native acceptance assertion or teardown finding identified.** This conclusion comes from the new complete run, not historical driver fixes. It does not establish other still-pending CI owners or regrade source.

## 🔎 Evidence inspected and integrity

Independently read the current ticket's explicit Safari rule, original SPN-137 failure disposition, committed desktop-offline/profile-probe harness assertions, native-summary and each browser's actual acceptance JSON. Verified all three ZIP SHA256 values against summary and checked matching source/tested/run/attempt identities, terminal passed state, all expected stages, profile/process identities and teardown records.

- Safari ZIP SHA256 `8cb24bbc889d7aee8c5fe3be959c757b3db7c703cb7b4bfb2a19d49768fe8788`.
- Chrome ZIP SHA256 `35c751439c98620778e3a50815509559efd33d51405bafa96ac3db47143c8be0`.
- Firefox ZIP SHA256 `5f2e4b413ea5819070c28185b86d93dec6fcce7059518e7941e6f719b5e937da`.

Safari records46 stages, Chrome44 and Firefox44. All have4 unique native browser process launches using the same per-browser recorded profile identity,4 matching successful stops and no report.error/teardownError/fixtureTeardownError. Both normal reconnects, both conflict recoveries, all4 retained items, actual storage deletion, missing-data rejection and complete stage are present.

## ✅ Safari-specific completed contract

Safari27.2 on macOS15.7.9 Intel/x86_64, runner macos-15-intel image20260824.0482.1. Versions record binds source360f, records current stable27.2 and actual installation from26.6. It is native Safari ordinary hosted-user profile `/Users/runner`, unchanged device/inode across launches, not Playwright WebKit or an emulated Safari profile.

The independent profile probe passes at the same source/tested merge: PID18822 exits and PID19218 launches; identical synthetic token survives localStorage, IndexedDB and CacheStorage with retained service worker. The harness asserts no additional network requests during offline restart. Paint baselines record visible focused native pages and matching canvas readback. Probe has no terminal error/teardown error. Its first bounded automation-prompt inspection was SIGTERM-limited; subsequent inspection found and accepted normal ephemeral-runner Safari consent while the original title request completed. This is retained setup diagnostics, not a failed/retried product acceptance journey. Do not describe every diagnostic suboperation as passing.

The application journey then completes:

1. All4 Sheet/Doc normal/conflict downloads; exact saved image hashes and private-record baselines; transport disabled and native process exited before relaunch.
2. Same-profile offline restart preserves exact original catalog/records. Real native edits are durably queued while server baselines remain unchanged: Sheet731 and Doc prefix `Desktop offline 731 `, with exact reconstructed body assertion.
3. Another ordinary offline restart preserves full queued records/checkpoints and image hashes. All4 native visible-content checks complete. Both Docs' clipboard evidence contains `Desktop offline 731 Recovery base notes`, with coherent selection ranges. The conflict Doc succeeds beyond the original historical missing-press boundary.
4. Restored transport publishes both normal items exactly once (revision2, full comparable expected snapshot and image equality, unchanged after reopening).
5. Both conflicts produce one owned recovery copy each, preserving concurrently edited original state, complete copied authored content/images and stable recovery receipts through reopen/outage. Both copies visibly retain real offline edits.
6. All controlled documents hand off to inert uncontrolled pages. Worker unregistration and quiescence pass, then native process exit/restart precedes actual cache/localStorage/private IndexedDB deletion. Every nested deletion operation passes. Catalog returns online but advertises0 available copies and no account storage marker; after another transport outage missing content cannot open and the page truthfully says it needs a connection, with0 native canvases.
7. Complete stage occurs2026-11-22T05:25:54.398Z; final native process29231 exits cleanly at05:25:54.851Z. Earlier matching PID20516/23069/24917 stops also record browserExited:true and driverExited:true. Fixture teardown succeeded because status remains passed without either teardown error field.

Persistence was not granted by Safari (`storagePersisted:false`); the UI truthfully disclosed possible browser clearing. Acceptance does not claim persistence permission or simulation of Safari's eviction heuristic: storage loss uses actual deliberate browser deletion APIs.

## 📜 Historical and scope limits

Original run41521489376/job125538619093 on b9e57e46 failed at conflict-Doc native input after third restart and never completed reconnect/storage-loss. Its exact first-attempt cause remains unresolved; today's success neither diagnoses nor erases it. SPN-137's driver/diagnostic repair alone was never acceptance. The new360f/ea02 first attempt now supplies the previously missing complete current Safari result.

This native suite uses collaborator editor grants and owns retained content/edit/reconnect/storage behavior. It does not substitute for the distinct account/anonymous viewer startup, transient notice, PDF, denied-edit and revocation owners. Those remain independently required. Native artifact retention is limited; preserve essential acceptance JSON/profile/version records and exact identities durably before expiry.

No runtime workload, repository mutation, remote action, grade change or other current reviewer report was used in this audit.
