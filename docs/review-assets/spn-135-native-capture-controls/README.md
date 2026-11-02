# SPN-135 common-entry capture preparation

Archival diagnostic helper af25f9b269243c84f8b323678de97769d0e56a1c. No product
change, acceptance result or further browser experiment is represented here.
The prior one-profile experiment remains failed and immutable at8fed4552.

Native capture now observes nonempty history/collaboration entry before mutation,
including native timer origins, policy/public calls, segment boundaries, immediate
mutations and history-command entry. It records origin/unit/phase/count/timestamps.
Tagged raw state is retained only below the32-item capacity boundary; larger groups
explicitly omit raw state. Limits:1000records,100000visitedvalues per selectedcache,
4MiB total including512bytes reserved for closingmetadata/punctuation perrecord.
Empty callbacks do not create substantive records. Capture can perturb timing;
its overhead is inside an outer policy interval, but outside the nativephase clock.

Actual hosted controls run41488410435 attempt1 job125424719564 at8a5b112f explicitly
reports2selectedtests passed,13filteredskips,69ms testtime/3.67s total. These extend
the two existing real-native frame-first and timer-first fixtures; no browser,
Chromium install or application build ran. artifact.zip is the original artifact
13163605728, SHA2565ba47b8acb956e51bd2c088b7892a52d08a6e7242885a39d2941267f217149de.
The original workflow piped Vitest throughtee withoutpipefail, so jobconclusionalone
was insufficient. Both reviewers inspected actualpassingoutput. The gate is fixed
by explicit shell:bash at155e8ad0. Native capture and these fixtures are unchanged
between8a5b andaf25; no duplicate hostedcontrols run was used.

The firstlocal56-case run passed55 and failedone newcross-VMprototype comparison;
normalizingonlythatassertion withstructuredClone gave a targetedpass. Firstoverlay
preparation rejected a nonunique350msanchor; contextualizing theanchor repaired it.
Bothfirstfailuresandcorrectedresults are retained. Fiveadditionalfocusedcontrols
passed firstattempt434.416083ms (watchdog470ms,241MiB):records/values/byteslimits,
capacityrawomission withouttraversing unsupportedstate, andoriginrestorationthrough
nativepublicationexception. Rejectedcapturepreservespublicationandcacheclearing.

Finalsource also requires futurebrowsercapture correspondence totheterminalnative
history/collaboration pair for the measuredunit afterlastkeydown andbeforetraceend,
equalpositivecountsbelow32andbothrawcaches. Itpreservestheoriginalpolicypairedmetric;
no summing separatecallbackdurationsasacceptance. Originalsourceoverlaypreparation
andNodeparsecheckpassed. Bothindependent reviewers approvedpreparation ataf25f9b2,
not a furtherbrowserrun or ticketcompletion. A newboundedreviewedprotocol is required
before anyfurtherhostedbrowserexperiment. Historical34.3ms remainsunresolved.
