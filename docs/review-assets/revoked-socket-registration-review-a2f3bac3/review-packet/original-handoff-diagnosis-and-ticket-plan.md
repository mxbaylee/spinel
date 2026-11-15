# 🔏 Separate session-revocation observation investigation

## Observed failure and ownership

Current SPN-128 source `d22baa6997e27c123ef351a8f5321089cc9e345b`, actual main
`8e9dccbd90f04ad79bd12cba3695e5c4ff04e02d`, tested merge
`9b48767d1effc0aeb55f6020d8676427d74f7d9f`: CI43658210882 attempt1,
development1/2 job132641633704 failed the flaky-test gate. The reporter has
76 expected passes,4 skips,1 flaky case. The two-login session-revocation case
failed retry0 in11,480ms at collaboration.spec.ts462: the unchanged5,000ms
poll never observed every selected protocol socket closed. Retry1 passed in
18,432ms; that cannot replace the failed first attempt.

First receipt: one target opened at5,161ms; edit-held/revocation-written6,383ms;
main-frame navigation6,438ms (+55ms); zero socket-closed/page-close events,
one open/zero closed targets,6 received frames; observerLost/overflow/reopened
all false. Later denial/queued-write/saved-reload/broadcast assertions did not run.
Retry receipt: actual observed close10,347ms, navigation10,395ms, complete contract.
Both attempts' cleanup arrays are retained in the original reporter. Only retry1
has a trace ZIP; attempt0 retains two screenshots, error-context and inline
content-free observation. Never claim the original physical socket leaked or
closed: neither is established by its missing observer event.

The exact16 source/dependency bindings in `source-provenance.json` are byte-equal
between actual main8e9 and d22: failing spec, observer and controls, sync-network/
native helpers, Playwright config, server/runtime scripts, auth store, transport,
identity, sync client entry points, package and lock. The observer/spec change is
merged SPN-149 commit `a3dfc6f3373babecf979d5b851bbbf46c6dbb3b9`, not SPN-128.
SPN-128's maintenance/supervised fixture changes do not own this security journey;
SOURCE_SHA adds evidence attribution, not revocation behavior. This is a distinct
pre-existing observation/runtime investigation. Register a new ticket on main
first and implement in its own PR. Do not reuse SPN-149 or modify SPN-128
opportunistically. SPN-128 remains NOT_ACCEPTED and unchanged until that actual
prerequisite lands and root integrates/revalidates it.

## Source interpretation and uncertainty

Pinned Playwright1.64.1/coreBundle.js attaches newCDPSession to the page target
(lines40194–40207), independently of its per-document WebSocket map. The page map
is cleared on main-frame navigation and webSocketClosed consults that map
(lines24680–24729), explaining the earlier SPN-149 conditional dispatch probe.
The new direct CDP path already bypasses this map. Its session wrapper forwards
received events and reports Target.detachedFromTarget (lines36327–36446); those
facts do not establish that Chromium delivered the missing close in attempt0.
Existing synthetic tests explicitly emit Network.webSocketClosed after navigation;
they test consumption, not actual Chromium delivery.

Production transport synchronously revalidates access before sends and on its
500ms tick, removes denied connections from the live set and requests
WebSocket.close(1008). That is source behavior, not this failed run's observed
physical close. The code is unchanged. Retain independent401 denial, real closure,
other-login continuity and saved native content as separate contracts.

Official [CDP Network documentation](https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-webSocketClosed)
defines the close event; it provides no cited durable-delivery guarantee across
this navigation boundary. Current-main [Chromium WebSocketChannelImpl](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/websockets/websocket_channel_impl.cc)
contains close probes in Disconnect/OnDropChannel. This current-main source is
not the pinned156.0.8078.4 binary. Its exact version tag could not be accessed
through the documentation tool. Do not infer pinned runtime behavior or original
causality from it. The pinned installed bundle/browsers manifest hashes are bound
locally; no dependencies were patched or installed.

## Complete scope estimate and decision

Proposed complete outcome **M**: one finite real-browser observation experiment,
a demonstrated narrow fixture correction if warranted, safe first-attempt failure
custody, focused positive/negative controls, and existing development/production
two-login hosted acceptance. Include source/authority/native investigation and
independent exact-head reviews; do not count only the helper edit. No product
policy, deadlines, retry/flake gate or accepted content/access behavior changes.
If the experiment instead reveals actual server closure/authorization failure,
reassess scope before product/transport implementation; do not conceal it as an
observer fix. If not reproduced, preserve that result and stop the declared sample;
no speculative source repair or repeat-until-green run.

Operator needs trustworthy bounded security evidence without document access.
Owner needs real revocation and saved-work protection; Collaborator needs the
other login's queued edit and stable socket preserved. Link guest keeps existing
capability denial and privacy, without introducing credential-bearing diagnostics.
No UI change. Fixture-only observations require a reasoned no-impact statement
for production emitters; any actual transport observation change must update the
emitter inventory, content-free schema and regression evidence in its own PR.

## Fixed experiment before choosing a repair

After registration, root review and an exclusive normal-pressure workload grant:
one small real Chromium invocation using pinned Node26.13.0/Chromium156.0.8078.4,
existing Playwright fixture and `observeSessionRevocation`, a task-owned loopback
HTTP/ws server, one worker, no retries, three fresh contexts/sockets. No app build,
install, cache mutation or full native matrix. Use the existing serial/2GiB/eight-
minute watchdog, private cache and a30-second outer probe bound. Stop on the first
harness/setup/resource error. This is a new declared experiment, not a rerun of
the failed hosted test.

1. **Close-first control:** establish a real101 socket and freeze its identity;
   request server close1008, observe the exact server ws and underlying socket
   close, then navigate. Record direct CDP and page events. Require the existing
   observer to recognize the actual close within its unchanged5,000ms deadline.
2. **Navigation-first ordering:** establish a fresh socket; allow a real new-
   document navigation while retaining the same direct CDP observer. After the
   navigation boundary, request server close only if the server connection still
   exists; otherwise record that the browser physically closed it earlier. Use
   real event barriers, not sleeps or an unload/navigation blocker. Record actual
   server ws/TCP close and both browser event streams. A no-op server close cannot
   be represented as a new physical event. Compare actual ordering rather than
   asserting the intended schedule occurred.
3. **Live-socket negative:** establish a fresh socket and deliberately withhold
   close while returning an actual synthetic401 HTTP response. The existing
   observer must remain false/reject assertRevoked(401); only afterward perform
   owned cleanup. Navigation, denial, method invocation or cleanup closure cannot
   satisfy the required protocol-close witness.

Use bounded ordinal connection identities, relative monotonic timestamps, event
kinds/counts and code/status only. No URLs, tickets/cookies, request IDs, frame
payloads or authored content in retained receipts. Keep original failure and a
snapshot before observer/context cleanup; record cleanup separately. Bind exact
helper, browser, package/lock and probe source plus all original outputs.

If actual physical close is observed but direct CDP misses it, that demonstrates
a present observation boundary, not the original run's physical outcome. Choose
the smallest proven navigation-independent passive witness tied to that exact
established connection; never accept navigation or401 alone. If CDP delivered it
but helper accounting failed, repair only demonstrated accounting. If closure
itself fails, stop for the product-scope checkpoint. Do not design a general
observation framework before this experiment.

After a proven correction, focused controls must reject absent/wrong/stale close,
live socket plus401, closed socket plus200, reopened connections, observer loss,
overflow, late broadcasts and cleanup-only closure. Preserve5,000ms closure and
60-second journey budgets, all queued-write/native reload/content assertions and
failOnFlakyTests. Then use the existing development and production owners, exactly
one retry-zero case each in the first reviewed candidate's hosted run; configured
retries remain separate failures. Retain first-attempt trace/receipt under one
trace owner and real uploaded filenames, not body-only attachment assumptions.

## Registration requirements and suggested ticket text

Use the existing `npm run backlog:new` CLI to allocate the next ID on actual main;
this plan reserves no ID. Suggested title: **🔌 Verify revoked socket closure
across navigation**. Effort M; Operator/Owner/Collaborator impact M, Link guest S.
Registration belongs in a separate main-first PR, with canonical decision record,
all-persona scope checkpoint, the concrete incident/provenance links and the
finite experiment above. Add the new prerequisite to the still-open main SPN-128
only through the proper ticket/index workflow; regenerate the index via CLI.
Implement under the newly allocated ID after registration lands, one ticket per
PR, two independent exact-head reviews before validation. Keep SPN-128 current
branch/source/reviews/history intact until actual-main integration is assigned.

Story: As the Owner, I want revoking one login to prove that its actual connection
closed even while it leaves the document, so another login's queued work stays
safe and later broadcasts cannot reach the revoked login.

Scenarios: a real closed revoked connection plus401 satisfies the security
journey across navigation; a live/unknown connection, unauthorized reopen or
later frame never passes; the other login retains its socket, queued edit and
saved/reloaded native value. Failure evidence survives before owned cleanup.

Rules: preserve all original SPN-149 and d22 first failures; no physical-leak or
historical-close claim without evidence; no timeout/retry increases or navigation-
as-close inference; finite declared experiment; content-free exact-connection
custody; separate product-scope decision if actual server authority is defective.

Verify: focused protocol-accounting negatives plus the three-case real boundary
probe; existing development/production two-login owners with unchanged assertions
and limits; exact source/runtime/plan/attempts, first traces/receipts and cleanup.
Shared observer/auth/transport/navigation/helper/package inputs keep automatic
selection and missing/failed selected workers cannot pass.
