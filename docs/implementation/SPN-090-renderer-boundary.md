# 🔧 SPN-090 renderer dependency boundary repair

2026-11-05. The completed source3ac03e9e build proves20initialJS chunks8,076,912B, including5,916,016B renderer via sharedUI/FloatingUI/Core dependencies. Full result archive5988c515ecfcecd4445f6676f4d5f8b33af5c38d. This does not prove the old Safari blank screen cause; no readiness timeout changes or newdeviceexecution yet.

Chosen repair: set includeDependenciesRecursively:false only on the explicit renderer group, leave the isolated module-preload group, and apply strictExecutionOrder:true to the shared production/dependency-optimization output configuration. Rolldown1.2.14's documented default captures shared dependencies recursively; its pinned types and official manual recommend strict execution order plus compatible entry signatures. Vite8.3.4 client already defaults preserveEntrySignatures:false; retain it. No new custom chunk lists, lazy route changes, CSS omissions, app entry API change or public data/authority change.

Extract the existing tiny renderer output configuration into src/build/rendererChunks.ts solely so the actual config can be exercised by one lower-layer real pinned-bundler fixture. Fixture main imports sharedUI, editor lazy imports renderer and its lazy dictionary. Baseline recursion must reproduce the accidental initialrenderer edge; repaired grouping must remove it, retain dictionary inrenderer/offlineavailableoutput, and successfully execute initial/sharedUI and latereditor/dictionary with correct side-effect order. Use current pinned installed bundler as a tool on the syntheticfixture, not donor application dependencies. Serial60s/2GiB/normalpressure. No fulllocalinstall/build.

After passing focused tests/staticchecks and two exact-head reviews, admit ONE changed-source build-only comparison on the owned integration branch from3ac03e9e, attempt1, same15m/10m job/build limits. Extend the existing final graph inspection with a strict renderer-boundary assertion: engine-render and layout dictionaries must be absent from application staticJSclosure; actual emitted renderer/dictionaries remain in complete shell and reachable from nativeeditor dynamic graph. Report exact bytes/allCSS, not a chosen aggregate threshold. Same originalfailedphonerecord staysfailed. An unresolved newgraph stops this candidate; no automatic rerun.

Actual app/native/worker execution and complete current-head requiredgates remain separate; the synthetictest is not productacceptance. A graph-qualified repair can then seek actual existing production/native/retainedruntime acceptance and a finite instrumented phoneattempt with proper phase/buildwitnesses. No paid attempt admitted here.

Personas: Operator avoids broad newdependencies and retains all offline assets; Owner/Collaborator get reduced irrelevant startup dependency whileeditor/history/nativebehavior remains required; Guest keeps existing separateauthority and runtime selection. No UIchanges/storiesneeded for this build-only boundary; any visible loading-state work is separate. Complete28k-lineSPN090 scope stillneedsfinalreconciliation. Finish146+090thenstop.

## ✅ Local source checkpoint

Six focused controls pass, including an actual pinned Rolldown build of the
small shared-UI/lazy-renderer/dictionary fixture. The prior grouping reproduces
the eager edge; the repaired actual configuration removes it and preserves
shared → renderer → dictionary evaluation when opening the lazy editor.
The graph validator rejects eager renderer, missing dictionaries, missing shell
members and lost editor reachability. It retains the complete new graph before
running the repair criterion, so a failed criterion cannot erase its evidence.

Scoped types, targeted lint/format and actionlint pass. The first scoped-type
run found a fixture-only union field mismatch; the fixture now names the same
initial-dependency field on each row and the repaired type check passes. No full
local app build or device execution occurred. Existing donor bundler/tool versions
match the lock and operate only on the synthetic fixture, not application code.
The complete production build, three entry roles, native/offline behavior and
physical-phone acceptance remain pending.
