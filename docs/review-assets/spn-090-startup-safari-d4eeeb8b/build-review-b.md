# 🔎 SPN-090 current authored Safari build review B

**The exact preallocation build satisfies its retained source, bootstrap-emission and renderer-boundary contract.** This review makes no claim about the running phone journey, actual bootstrap execution on Safari, installed persistence, cleanup or its final outcome.

Run `42080221117`, attempt 1, is the single Safari-acceptance workflow dispatch on `codex/spn-090-real-devices`. Its retained run and artifact metadata identify source `d4eeeb8b4871695a0efc9b2c09259cc801784894`; graph, identity and complete/settled result agree on source/reviewed source/event SHA, tree `ee14758d57461c4a79176d6417ed9ce2f00c6058`, run and attempt. Here the dispatch event SHA equals the actual checkout; this is not the earlier PR merge identity. Source and tree were independently compared with Git.

## 📦 Complete retained build

Artifact `13439879208` contains the original `authored-build.zip`, **3,652,721 bytes**, SHA-256 `a0bde470faf4a38b8391a43bffe8d35626e86fd1afbb75e1023e4997cadb96a1`, matching GitHub metadata. The bounded verifier checked CRCs and all **51 members**: three build receipts and every one of **48 final dist files**, with safe paths, complete sizes and SHA-256 identities. Nothing was rebuilt, executed as application code, omitted or replaced. Nine retained source hashes match the exact Git source, including lockfile, Vite configuration, renderer grouping, entry/application, bootstrap helper and graph/inspection scripts. Node v26.12.1, Vite 8.3.4, Rolldown 1.2.14 and production `VITE_SYNC_EVIDENCE=1` are recorded.

The workflow source orders clean install and typecheck before its single inspected build, then requires the complete build artifact upload before BrowserStack setup/allocation. The complete uploaded artifact establishes that retained prerequisite; the eventual phone journal must separately prove which inspected bytes were served and observed.

## 🧩 Current graph and bootstrap

The application import's static JavaScript closure remains **21 chunks, 2,806,303 raw bytes, 717,301 summed per-file gzip bytes**, compared with the retained older build's 8,076,912/1,971,222. This metric begins at the dynamically imported application entry; it is not a measurement of all HTML/bootstrap network traffic, transfer encoding, parsing time or startup latency.

All **78 exact renderer modules** match the committed baseline inventory, remain outside that application static closure, are reachable through both actual DocEditor and SheetEditor dependency graphs, and remain in the offline installation descriptor. The renderer chunk is 5,304,972 bytes/1,246,960 summed-file gzip bytes. All seven pre-render stylesheets total **325,951 bytes**, with identical hashes to the previous build. No renderer/dictionary functionality or stylesheet is silently omitted to meet the criterion.

Current `src/shared/bootstrapEvidence.ts` is source-bound by SHA-256 `ee645d41cb6bf18afe12e782b6906fa72f9486c68568570b4e6d632d27fc6586`. It and `web/main.tsx` are emitted in **`assets/main-CrwiSL1S.js`**, an actual HTML runtime entry (4,909 bytes, SHA-256 `29a591437af356605d8681a6484e89c134c33296b6cf324b7bc56fa29788b0e1`). That entry dynamically imports the retained application entry. Its exact emitted bytes contain the opt-in read surface and import-end/styles-end/start-returned markers. This proves emission and graph placement, not that those phases have executed on the phone. The build remains subject to the previously reviewed bounded, identity-free observation contract; successful function return alone is not DOM readiness.

## 🧪 Reviewer verification disposition

`audit-build-b.ts` and `build-proof-b.json` retain the complete member proof and independently recomputed closure/editor/renderer/CSS checks. The corrected verifier passed in **789 ms**, peak **203,520 KiB**, normal pressure, under the shared serial runner and 60-second/2-GiB watchdog.

The first reviewer verifier failed because I incorrectly required the bootstrap entry to belong to the *application* static closure. The graph correctly places bootstrap in the separate HTML entry that dynamically imports the application. I preserved `audit-build-first-b.ts`, `build-audit-first-b.log` and `build-watchdog-first-b.json` (795 ms/201,296 KiB), inspected the actual graph, and repaired only that assertion to require HTML runtime entry placement and the dynamic application edge. The build and every artifact byte stayed unchanged; no browser, provider, build or phone attempt was repeated.

## 🦊 Owner-recorded Firefox scope

The maintained SPN-090 record at lines 4477–4496 explicitly records the owner's November 4 choice: BrowserStack Android Firefox has no working offline control after the retained no-network, airplane-mode, refusal-server and privileged-context results. `POST moz/context` returned HTTP 404. The privileged switch is removed and must not be retried. A selected Firefox lane ends **blocked/incomplete with exit 1**, never passed; physical-phone offline behavior remains **unobserved**, with desktop Firefox and shared browser specifications owning the stated product contracts.

That explicit owner disposition is part of the current completion scope. It does not authorize another paid Firefox run, and I do not invent such a run as a prerequisite. Conversely it cannot be relabeled as observed physical offline acceptance or used to make a selected blocked job green. My earlier wording that Firefox requirements remain separate should be read with this recorded limitation, not as a mandate for new allocation. Chrome installed-context and the full current Safari authored outcome retain their own distinct obligations. This build audit neither closes those obligations nor approves merge.
