# 🔎 SPN-090 emitted startup graph — independent outcome B

**The single build-only observation succeeded and supplies a concrete startup dependency finding: the initial application statically depends on the 5.9 MB renderer group through shared UI/runtime modules. It does not establish the historical Safari failure's cause or any phone acceptance.**

Source **3ac03e9ecf48798aa4942aba1f1ab0fb4650c09b**, tree **9c4810ecdf88434917c278b94a0efc2587081c05**, event-before **5bb97d17484ca7df151114ad2f6e28a03b4630c2**. Run **42060405449**, attempt **1**, job **127360149344**, terminal success. Artifact **13432470542**.

## 🔐 Independent integrity verification

The original ZIP is **3,579,896 bytes**, SHA-256 **01ebb0d88d6f4c664fd8218bb46c7da29a4aac250863db5d105559890b4fa5d0**, matching declared artifact identity. One coordinated serial/watchdog audit passed in **706 ms**, peak **201,024 KiB**, normal pressure. All **50** ZIP members passed CRC and individual size/SHA verification. All **47 final dist files** match the recorded final-file inventory exactly; extracted graph/result equal their original ZIP members. All six declared source hashes were independently checked against the exact committed source using git, and source/tree/run/attempt agree across graph, identity and completed result.

I independently traversed the reported static import edges, including deduplication, and reconciled the resulting closure and byte sum. Evidence is in `proof-b.json`, with original identity in `identity-b.json`; helper, log and watchdog are retained here. This was read-only artifact/source inspection. No build, browser, provider request or phone session was executed by the reviewer. The local heavy slot was released immediately afterward.

This proves a complete new build inspection using Node26.12.1, Vite8.3.4, Rolldown1.2.14, production mode and VITE_SYNC_EVIDENCE=1. It does not claim a recovered copy of the old phone's emitted bytes.

## 📦 Actual initial dependency findings

The application entry is `assets/application-8TWMM7LW.js`. Its transitive static JavaScript closure is **20 chunks, 8,076,912 uncompressed bytes**, with **1,971,222 bytes** summed independent Node-default gzip estimates. The estimates are neither observed HTTP encoding nor an execution-cost measurement.

The dominant static member is `assets/univer-renderer-DCzWCcTA.js`: **5,916,016 bytes**, estimated gzip **1,456,192 bytes**, approximately73% of the initial JavaScript byte total. Its 285 module entries include the renderer implementation and layout dictionaries, but also shared Core, FloatingUI, RxJS and supporting modules. The largest rendered-length entries include engine-render itself, several large language dictionaries and @univerjs/core. These are membership/contribution metadata, not additive final-byte or CPU attribution.

Critically, this renderer chunk has static incoming edges from **floating-ui.react-dom, theme, CopyFile and offlineStore**, all in the initial closure. Inspection of the actual emitted floating-ui.react-dom bytes confirms an import of renderer exports at the start of the file. That chunk also contains React DOM, while the theme chunk contains BaseUI/FloatingUI/lucide machinery. Therefore lazy editor routes do not establish a renderer-free anonymous startup. Merely deferring Dashboard/CopyFile leaves other mandatory paths to the renderer.

The named slow chunks are not equivalent to their source names:

- CopyFile-C6i42XXv.js is **637,550 bytes**, estimated gzip110,896. Its membership includes emojibase's full English compact data, appearance/profile settings and shared editor UI; the CopyFile form itself is a much smaller contributor.
- theme-BUKfwjsk.js is **590,277 bytes**, estimated gzip149,728. Its large entries include lucide icon aliases and BaseUI/FloatingUI components. It is not merely the small palette/theme-preference initializer.
- application-8TWMM7LW.js is **341,972 bytes**, estimated gzip96,348, containing Dashboard, backup/restore, Space, Maintenance and App among other eager surfaces.
- profile-BzxfUm23.js is **282,021 bytes**, estimated gzip57,352, with the profile icon catalog as a major member.

The existing source already shows a second concrete coupling: `offlineStore.ts` imports the offline-creation request validator from a module that also statically imports Core snapshot construction. The graph records its renderer-group dependency, although the graph alone does not prove that separating this one validator removes every path. Shared UI imports independently retain the renderer edge.

## 🎨 CSS and HTML ownership

Bootstrap awaits **all seven descriptor stylesheets**, totaling **325,951 bytes**, with summed estimated gzip52,877. This includes documentReady114,439 bytes and lib124,162 bytes, alongside application58,909, CopyFile16,915, theme5,632, HistoryBrowser3,361 and nativeCopy2,533. This is a separate pre-render dependency set from static JavaScript; calling the 20 chunks the entire startup network path would be inaccurate.

The final HTML classification preserves the actual installation aliases, fixed favicon URLs including queries, and emitted bootstrap/preload assets. Installation aliases resolve to exact hashed retained files; fixed favicon routes are correctly labeled server-owned rather than falsely claimed as emitted bytes. The original inspector applicability defect is no longer blocking this build. This build did not issue requests to those server routes or validate their response behavior.

## 🔬 Smallest evidence-supported repair hypothesis

The strongest first hypothesis is **remove accidental shared-module coupling into the renderer group from the anonymous application closure**, while keeping editor layout dictionaries and all offline assets available when actually needed. This is narrower than immediately restructuring every authenticated screen or changing readiness timers.

The current Vite grouping deliberately keeps renderer dictionaries together. The graph shows that the group also contains shared modules needed by initial UI. A candidate should first determine which grouping/shared-import boundary makes UI consumers import the whole renderer group and separate those public shared dependencies without changing their behavior. The earlier explicit module-preload isolation is precedent for fixing a demonstrated chunk-boundary dependency, but it does not identify the exact correct new configuration automatically. Inspect the pinned bundler configuration/semantics before choosing a change; do not add a list of guessed chunk rules solely to make a byte total smaller.

A meaningful lowest-layer regression would compare emitted closures and require anonymous startup not to statically pull engine-render/layout dictionaries through shared helpers, while native editor imports still retain their complete required dictionaries and executable dependencies. It must preserve shell inventory, CSS/runtime compatibility, native startup and existing offline account/guest admission. If an unavoidable true Core dependency remains, report it honestly rather than deleting required functionality or claiming a completely SDK-free entry.

Only after that boundary is understood should smaller lazy authenticated-surface or validator/snapshot-module splits be considered. The graph demonstrates they may help, but no single Dashboard/CopyFile lazy import addresses all existing renderer edges. Likewise, delaying CSS requires a separate correct style/admission plan; stripping editor CSS from the descriptor without preserving lazy/offline styling would be an incomplete repair.

Pending/rejected bootstrap behavior controls remain useful: the source has an empty root until worker selection, application import and styles settle. A loading indicator can make that state legible, but it is a separate UI result with stories/current visual review and does not itself repair anonymous readiness or qualify the phone.

This report establishes a candidate hypothesis and regression contract, not permission for another build/runtime/provider execution. Any selected change needs its prospective bounded verification plan, complete local source review and later current-source acceptance.

## 🍎 Historical and product limits

The new emitted asset names and recorded sizes align with the old Safari build log for application, CopyFile, theme and renderer. CopyFile/theme sizes also match the retained HAR metadata. This corroborates the relevance of the same dependency shape. The old phone's response digests, complete emitted bytes and import/evaluation phase timestamps were not retained, however; matching hashed filenames and sizes are not independent byte-equality proof for every historical response.

The sanitized HAR did not retain a renderer request or absolute phase-aligned request timing. That absence cannot show the renderer was not needed or loaded, nor establish whether capture, caching, unfinished fetch, evaluation or other conditions explain the old blank screen. The graph proves a static dependency, not a completed phone fetch or CPU cost. A successful new build cannot diagnose the old worker-selection, transfer or execution state.

The original Safari readiness failure therefore remains unresolved/unclassified. There is no10-second dynamic-import timeout to increase;10seconds belongs to stylesheet loading after import. No new device allocation was performed and no ordinary or physical acceptance gate is waived.

Operator gains a reproducible actionable dependency finding without device spend. Owner/Collaborator still need actual installed/offline/content/history/reconnect outcomes; Link guest must not inherit account authority in any startup split. SPN-090 remains unfinished, and the user scope remains SPN-146 plus SPN-090, then stop.

## 🔧 Prospective pinned-bundler refinement

I checked the proposed `includeDependenciesRecursively: false` option against the installed Rolldown1.2.14 types and the official [manual code splitting guide](https://rolldown.rs/in-depth/manual-code-splitting). The documented default recursively captures dependencies, matching the actual renderer group's shared-module membership. Applying false **only to the renderer group**, while leaving the preload group intact, is the smallest concrete candidate for this observed coupling. This is a supported mechanism, not a guarantee that every unwanted static edge disappears.

The pinned type documentation recommends both compatible entry-signature settings and `strictExecutionOrder: true` when disabling recursion. Installed Vite's normal client build already defaults `preserveEntrySignatures` to false; no repository override was found. Thus a new entry-signature policy is not presently necessary. Explicit strict execution order is a defensible companion safeguard, with its documented module-wrapping/size impact recorded, rather than waiting for an accidental evaluation-order failure. It is not a substitute for exercising application exports, worker initialization and lazy editor startup.

The prospective criterion should require engine-render implementation and layout dictionaries absent from the initial application static closure, but still retained in complete shell assets and reachable through native editor imports. Shared Core/UI dependencies may legitimately remain; do not require an unsupported zero-SDK claim. Verify all three entry roles and offline compatibility, compare actual new bytes and inspect any new cycles/order diagnostics. Keep CSS and historical phone-cause limitations separate. This narrows the candidate proposal; it authorizes no configuration edit, build or runtime execution by this reviewer.
