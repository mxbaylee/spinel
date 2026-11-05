# 👁️ SPN-090 pending-storage visual review A

**Agent review only — scoped visual approval granted** for the changed pending-storage result on source **6f9a92e41996f8fca7b8e90ede61bbbb3242ce4b**. Reviewer A independently opened and inspected all three actual PNGs with view_image, read the receipt/capture script and current production component/story, and compared the result with the design playbook, offline-state guidance, review runbook and theme. No source edits, build, browser run or device allocation were performed by this reviewer.

## 🖼️ Evidence and provenance

The captures are current production `OfflineAvailability` rendered with synthetic `ProtectionPending` story data, not a live account or storage permission request. Hosted Storybook artifact **13411321845**, run **42020272024**, identifies source 6f9a92e41996f8fca7b8e90ede61bbbb3242ce4b and checkout **cec5d9174335371d0dfe3166b85e8c8545d7c0d4**. The capture helper checks the supplied archive digest and built sha.json before rendering; it does not rebuild locally. I independently checked all three PNG hashes against receipt.json. I did not repeat the complete build-archive hash stream or audit every Storybook result.

Reviewed images under `visual/pending-result/`:

- `storage-pending-light.png`: light, 1280×900; SHA256 79434519b85448046b00594736173c551d8fcf131e4e506c1336aa4306c7b97a.
- `storage-pending-dark.png`: dark, 1280×900; SHA256 b97330464981683f980c240aa8de61b2685ae24e48bce4317b379319197bf129.
- `storage-pending-phone.png`: light phone viewport, 390×900; SHA256 23008afdc5a3ecb402fa65ae8d150d91b8bfb7155d5907c5a7ed7cc0634c944d.

The script waits for the exact story's successful play completion and rejects recorded play/page exceptions. It then uses ordinary Escape to dismiss only About device storage, verifies that Offline availability remains visible with pending detail, and asserts focus on How to keep them before capture. The fixed fixture time is 2026-10-20T16:00:00Z. Receipt records Chromium 156.0.8078.4, browser/server closed; watchdog reports command-passed at normal pressure in 2,725 ms, peak 674,704 KiB. These are inspected retained execution results, not newly rerun assertions.

## ✅ Visual findings

No actionable visual defect found in this state. In both desktop themes, the modal has a clear title/icon, separate close control, readable result and pending explanation, and grouped actions at bottom right. Warm light and purple dark surfaces follow the existing token-based controls; the magenta focus ring is visible in both. The state is conveyed by text, not color alone.

At 390 px, the panel maintains side margins; title and close control do not collide. The explanation wraps naturally without clipped text or horizontal overflow, and How to keep them and Done remain together and fully visible. Phone controls have comfortable visible target dimensions. The focused help trigger is visibly distinct without making the screen appear to contain two competing filled primary actions.

Copy accurately separates the completed fixture download from the still-undecided storage permission. It does not say the copy is permanent or backed up. The help action provides the relevant next step without blocking completion; Escape/focus restoration matches the playbook's in-place storage guide pattern. Production source uses the shared Modal/control classes and a polite live detail region; the screenshot alone is not a screen-reader test or numeric contrast audit.

## 👥 Scope and limits

Owner and Collaborator can read the pending warning and return from guidance without losing their place. Operator gains no new document access or operational controls. Link guest is outside this account-download state; these fixture images do not prove guest restrictions, which remain source/integration obligations.

This fills the specific capture gap where the original ProtectionPending play left the help dialog open. Approval is for the current pending result and inspected return-focus state across these three views. It does not independently approve every other UI state, current full-app routing, native editing or account persistence. The images show synthetic Storybook data in local Chromium, including an emulated phone viewport, not physical iPhone evidence.

The current Safari real-phone run remains failed at blank sign-in and cannot be reclassified by these captures. Hosted seven-gate/native acceptance and the complete SPN-090 outcome remain separate. Final PR evidence should embed these useful current images with source/theme/viewport/state and fixture captions, retain this scoped **agent review only** approval, and preserve the physical-device failure disposition.
