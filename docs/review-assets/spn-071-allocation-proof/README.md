# Native marker investigation retained from SPN-071

Original candidate source:53ad6848d79b7b5034db6f6e99a107a518f5d9e5, base df1d910.
The parent commit fdde643c retains all helper source, predeclared plans, failed
prototype and revised marker-only proof. No helper code is proposed for merging.

First shortcut work proof failed: native composition preserves separate INSERT
operations. Revised per-character prototype passed synthetic parity/work checks,
but real-cache replay failed activation0/8. The browser capture itself passed;
it exposed the existing native marker __textXPreserveParagraphIds:true on every
ordinary insertion. Spinel sync capture sets it before native mutation, and core
preserves/consumes it for paragraph identities. Existing balanced eligibility
rejected the known marker and used the original fold. The proposed template
algorithm is abandoned; reviewer B also identified its undeclared undo scope.

Marker-only proof permits exactly own true or absence and otherwise retains all
existing guards/algorithm. Initial marker proof used the obsolete shortcut's
TextX-call-count activation assertion and failed. Revised proof directly checks
the existing pure guard on short cases and iterator reduction on actual32-state
caches. It passed9/9 tests:288 exact synthetic cases and8 native captured caches
in both ES/CJS. Seven plain caches activated; the paragraph-containing cache
retained exact fallback. Typical color-only clone allocations23436→8658(63.1%),
clone visits50406→18550. These count instrumented native clone allocations,
not every JavaScript allocation. All measured outputs matched native/current
publications exactly, including own undefined fields and cache/publication
mutation checks. This does not prove the cause of the untraced165.8/113.5ms
failures or establish100ms browser acceptance. Fresh normal checks are required.

Capture: source field records cbb5b04 plus then-uncommitted diagnostic edits,
subsequently retained byte-for-byte in bf0eb142. Application runtime is53ad684
plus the helper observer (first8 full caches before flush); build used private
npm-ci installation with allfive current ES/CJS patches. Mobile390×844,
unthrottled Chromium, firstthree existing responsiveness paragraphs, one loaded
sender/no loaded peer. Tagged JSON preserves own undefined fields. Copies make
all capture timings diagnostic only. Test1/1passed, watchdog8.970s/1654.1MiB.
Proof final3.511s/468MiB. Native16-paragraph acceptance was not run here.

Retain every first failure. Source-map build pressure abort is retained too;
normal identity rebuild passed. See earlier linked diagnostic archive593a65d9
for original incomplete trace and CPU profile; no GC subtraction or budget change.

Scope decision: this mismatch predates071 and is independently useful onmain.
Register a separate prerequisite correction, keep071draft, then verify/land the
correction independently before rebasing071 and repeating its current-head gates.
