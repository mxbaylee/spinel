# 🕰️ Guest startup lifecycle repair

The pre-repair candidate is `18c3170590c162bebe118a17e4b47d7df40f36ad`.
`receipts.json` binds the final positive execution to the exact GuestApp/test and
shared startup/dispatch/account/story/config bytes (`finalInputs`). The negative control used the retained pre-type-correction test snapshot; the final
positive reran after its DOM-only wrapper typing correction. The candidate containing this
record owns the repair; the original integration and browser results keep their
original identities. No previous numerical review assessment is included here.

## 🔬 Contract and environment

`e2e/startup-lifecycle.spec.ts` runs actual bootstrap, application dispatch, React
GuestApp/Space, and AccountApp with deterministic scoped HTTP responses. A ready
empty guest Space avoids invoking any native editor. The controlled clock advances
wall time and then one interval tick: it does not replay two minutes of polling or
exhaust unrelated HTTP timeouts. Browser wrappers retain the actual first bootstrap
interval handle/callback and observe its disposal. A held application import proves
that this handle actually drives the visible public startup status before React.

The five controls cover a slow import followed by ready guest entry (line removal,
interval disposal and silence beyond 120 seconds), unavailable/revoked/unsupported
guest entry, and a still-pending real account sign-in which must keep reporting.
The test does not invoke `startupDone` directly or reproduce the effect under test.
Existing configuration selects five development and five production cases only.
Development validates the mounted lifecycle; production separately validates the
packaged application import boundary. Full hosted production acceptance is pending;
`--list` proves selection, not execution. No routing/configuration change was needed.

## 🧾 Attempts retained

- **First attempt:** three guest blocked-state controls passed; two fixture
  assumptions failed. Desktop's ready empty Space exposes “This Space is empty”,
  not its phone-only navigation button. Account API lives at `/api/auth/session`,
  not `/api/session`. Both first failure contexts and the complete log remain here.
  No product failure was hidden and no assertion budget was increased.
- **Corrected source:** all five controls passed, 7,008 ms guard elapsed,
  1,283,216 KiB sampled process-tree peak. Assertions use the actual empty-state
  heading/name and actual admission endpoint.
- **Negative control:** restore only pre-repair GuestApp from `18c31705`, keep
  the corrected test, and run the ready-guest case once. It failed at the visible
  startup line remaining after the actual empty Space mounted: 8,548 ms,
  1,307,920 KiB. `negative-visible-line.png` and `negative-context.md` retain
  this expected failure. Restore the exact positive GuestApp bytes afterward.
- **Typing and final source:** the first full compiler completed with a genuine
  Node/DOM timer overload error in the browser wrapper, 9,002 ms / 1,707,360 KiB.
  A DOM `Window`-typed reference fixes that ambient type boundary without changing
  the callback or test contract. Final full typing passed, 9,201 ms / 1,685,440 KiB,
  with GOMEMLIMIT=640MiB, GOGC=50, GOMAXPROCS=2. All five final browser controls
  passed again on these exact bytes, 7,211 ms / 1,415,152 KiB. The earlier negative
  remains tied to its preserved test bytes; it was not repeated or relabeled.
- **Other focused checks:** seven startup timing/import tests passed; targeted
  lint passed. `receipts.json` and compressed complete logs retain commands,
  identities, result codes and measurements (zero peak means unsampled).

All executions used pinned Node 26.13.0, shared serial, runtime pressure monitoring,
a 2 GiB process-tree cap and eight-minute limit. No guard abort occurred in these
checks. Explicit owned-process audits after positive and negative browser completion
found no remaining task server/browser/guard/serial descendants; repaired source was
byte-compared with the positive snapshot. The earlier integration full typecheck resource abort
remains a historical abort. New test source justified the fresh compiler execution;
its real type failure was repaired before the final full type pass. All required
current-head hosted acceptance remains pending.

## 🎨 Applicability

The repair changes when an existing startup line disappears; it adds no component,
layout, theme or copy. `web/startupStage.ts` and `web/StartupStage.stories.tsx` retain
their exact earlier bytes, as do storage/icon rendering inputs. Retained visual
captions remain historical/source-bound. Fresh actual mounted lifecycle controls
supply the interaction evidence absent from that static story. The negative image
is diagnostic failure evidence, not the proposed visual result. Independent exact-head
visual/interaction approval remains required before publication.
