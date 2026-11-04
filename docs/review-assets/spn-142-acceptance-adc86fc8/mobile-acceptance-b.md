# ✅ SPN-142 adc86fc8 mobile responsiveness acceptance — review B

**Accepted for this exact source's current mobile responsiveness owner.** No actionable evidence blocker found. This preserves old failures and does not prove their inner causes, actual V8 allocation/GC savings, or universal future latency bounds.

Source `adc86fc835e93f1960b1b1133864fb43b0aa69e7`; base `7679351822caaa9535d73d656191f2a6597a3380`; tested `a0cb7906f06c986411cda24b790c3b2dadac6252`; independently matched source/tested tree `fabcde8b11ee851d31ebe3e6a3a3b80f699b7dc3`. CI41928232046 attempt1, job126919181093, artifact13371558876. Original ZIP SHA-256 independently matches `f08f0fcc167526209b5e7cc9f2c9744449dc6776293f9efbf2e82238cd881fcd`. All18 extracted members equal their ZIP bytes; both CPU profile hashes match their metric and clock records. All nine sustained-case harness hashes and the post-burst harness hashes match exact source Git blobs. No test/browser execution, source edit or profile/large-trace reanalysis was performed.

## First attempts and raw measurements

Baseline source `2c84a18449c7dae09e2817989fac6236be96ef98` has four expected passes; candidate tested merge has seven. All11 tests passed retry0, with no skips, flaky/unexpected results or report errors. Every sustained case has attempt0 and completed:true. Current paired comparison is passed/timingValid/candidateIntegrity true with no failures or unavailable requirements. The full plan identifies this exact synchronization and selected paired owner.

Mobile uses the unchanged emulated Chromium/fourfold throttle contract, not a physical phone. Candidate plain1/2/3 values, independently checked against raw frame/flush/long-task arrays:

- Input-to-frame p95 **79.4 / 79.3 / 87.7 ms**, against200 ms.
- Longest task **163 / 205 / 136 ms**, against500 ms.
- Capacity p95 **19.8 / 17.8 / 26.4 ms**, against50 ms; maximum **27.8 / 27.1 / 46.9 ms**, against100 ms.
- Idle p95/maximum **2.4 / 2.2 / 2.2 ms**, against50/100 ms.
- Browser-local first verified empty **380.5 / 412.8 / 408.2 ms**, against1,000 ms. Descriptive later-read upper bounds remain721.0 /850.2 /867.0 ms and are not substituted as the acceptance metric.

Each candidate sustained case has65 actual32/32 capacity pairs and one6/6 idle pair; retained idle quiet time meets300 ms. I recomputed p95 and maxima from raw arrays, checked group sizes, and matched raw maximum long tasks. No averaging away maxima, profile substitution, GC subtraction or changed budget was needed.

## Content, history and access

All four candidate sustained samples retain2,086 keydowns and2,086 frame observations, drained queues0/0, high-water32/32,66 undos/0 redos and exact2,088-character sender/peer/saved content hash `6c714aa1049090072c1b3c4acb27bf6e12c9e56426c8df01cf069a23c6529b44`. Pre-Undo integrity passed; final content hashes independently agree across all three surfaces. No candidate browser errors or reloads remain.

Plain1 actually undoes all66 observed groups to0 undos/66 redos and redoes all66 to66/0 with restored exact content/selection/saved-peer state. Plain2/3/profile exercise the final six-state group, reaching65/1 then66/0. This is actual complete-history replay in its owning sample, not merely a count of retained groups.

Quiet-pause continuation retains450.8 ms actual browser quiet gap,108.8 ms continuation key-to-frame,109.4 ms key-to-native-read,95.48 ms request return and559.6/560.2 ms final-original-key-to-frame/read. Those satisfy the unchanged350 ms requested pause,500 ms continuation,1,000 ms request and1,850 ms combined limits. The case completes with exact saved/peer behavior and no errors/reloads.

The composition boundary preserves provisional text/history on composing Enter, excludes cancelled provisional content and atomically undoes/redoes finalized composition with exact saved/peer text. The revocation boundary holds one write, records `forwardedAfterRevocation:[false]`, unchanged persisted snapshot/revision and denial of the old capability. Both pass with errors empty. `physicalIme:false` remains explicit; these are synthetic composition-event controls, not real OS IME qualification.

All baseline observations preserve their baseline-only redo-at-capacity refusal and recovered empty state with valid initial integrity. Their passing observation contract does not mean candidate latency/history requirements passed on the baseline.

## Profile and historical disposition

The candidate profile completes separately, with capacity max30.4 ms and idle0.6 ms, but `budgetEnforced:false`; primary acceptance is the three unprofiled cases. Its clock uncertainty is1,344 ms, negative/reordered sample counts0/0, and history/collaboration samples exist without certain containing-task attribution. No exact candidate reducer time or explanation of a previous unprofiled spike follows. Profiles were byte/hash checked, not independently reanalyzed.

The original102.4 ms and overlooked115.6 ms capacity failures remain failed observations. Prior source arithmetic/prefix controls support the selected work reduction but do not reconstruct those missing failed caches or prove composition/GC/scheduling caused them. The later25.3 ms desktop idle failure also remains real: this source adds a separately justified fixed-list work reduction on the ordinary six-state path and now has fresh unprofiled acceptance. Desktop review A independently verifies both policy-idle and native-timer ownership on this same source. That combined semantic/work and fresh native evidence supports current SPN-142 acceptance without erasing unknown historical causes or claiming a guarantee against every future tail.

The separately observed historical callback trace-completion/cleanup issue remains SPN-143's registered XL outcome. This mobile pass neither resolves that owner nor substitutes for current callback acceptance. Operator gets reproducible observations and honest limits; Owner/Collaborator retain exact history/persistence; Link guest retains revocation enforcement. No routine screenshot is required for these passing non-UI cases.
