# ⌨️ SPN-090 native input delivery checkpoint

## 🛑 Retained failure and scope

2026-11-05, agent judgment under the owner's instruction to finish SPN-090 and
SPN-146, then stop. Source `d4eeeb8b4871695a0efc9b2c09259cc801784894`,
Safari run `42080221117`, attempt 1, reached installed offline relaunch and all
four retained Doc/Sheet image checks. The first authored Sheet edit required
`731`; the actual screenshot showed `73`, and insertion counts were 1, 2, 2
with the editor focused. The unchanged two-second insertion deadline failed.
Networking, session, fixture and tunnel cleanup completed. The attempt is
closed; no unchanged retry or character resend is admitted.

[Complete outcome and independent review](https://github.com/mxbaylee/spinel/tree/124f3fdaa8ea03e53712ceaedc2202a416fcabbc/docs/review-assets/spn-090-startup-safari-d4eeeb8b)
preserve the first failure. Ordinary CI, native desktop and current visual
acceptance passed on that source; they do not replace physical input acceptance.
The complete outcome remains XL, including Chrome's separate storage-loss
investigation and the owner's maintained Firefox provider limitation. This
acceptance evidence gap belongs here; splitting it would not make the ticket
complete.

## 🔎 Distinguishing delivery from event cancellation

The existing counter proves missing insertion, but cannot tell whether the
third native action produced any DOM event, whether an event was canceled, or
whether focus changed during delivery. A focused element before and after a
command does not establish its focus throughout the command.

An empty range means no event reached this recorder, not proof that no DOM
event occurred: propagation and recorder ownership limit that inference.
Per-key sequence ranges use the existing focus/read commands and describe
observation order, not proof that a late event belongs to the current key.
Finalization reads only events whose `eventPhase` is zero; active dispatches
retain an explicit pending state. There are no queued finalizer callbacks.
The post-dispatch cancellation flag is an observation, not attribution to a
particular listener or proof of when that listener set it.

Do not replace native typing with a web-element value setter: Appium's public
web implementation can use a Selenium atom and dispatch a synthetic input event.
Do not add sleeps or move to the legacy keys route merely because it has another
name: current public WebDriverAgent implementations use the same underlying text
event synthesis for W3C key groups and raw keys. These sources establish API
behavior, not the unrecorded provider version or the historical failure's cause:

- [Appium element commands, inspected blob c8aac044](https://github.com/appium/appium-xcuitest-driver/blob/cd2efd3fa4e58cf50a2b37dc38b2a2de5de9a635/lib/commands/element.ts).
- [WDA key synthesis](https://github.com/appium/WebDriverAgent/blob/3d6a4e03cdd673e540289c610f7e189f8ffea434/WebDriverAgentLib/Utilities/FBW3CActionsSynthesizer.m).
- [WDA raw typing](https://github.com/appium/WebDriverAgent/blob/3d6a4e03cdd673e540289c610f7e189f8ffea434/WebDriverAgentLib/Categories/XCUIElement+FBTyping.m).

Extend only the existing temporary input counter with bounded, copied event
observations. Observe keyboard, beforeinput/input, composition and focus events;
retain fixed event/type categories, trust/cancellation flags and editor/focus
booleans, never keys, text, values, selectors or document content. Observe final
cancellation after dispatch without calling preventDefault or changing focus.
Keep explicit overflow/unavailable states and isolate a replaced/stopped recorder
from delayed callbacks. Use the existing focus and counter reads rather than
another provider polling loop. Keep the original per-key actions and every
deadline/content assertion unchanged. Preserve the first operational failure if
evidence recording or removal also fails.

Lowest-layer verification uses the existing fake driver and VM event fixture:
missing third insertion stays failed with no replay; delivered/canceled versus
absent events remain distinguishable; snapshots cannot mutate retained state;
overflow, malformed observations and delayed callbacks remain explicit; a
recording failure cannot mask the dropped-character cause. Scope remains the
native acceptance harness, with its existing CI owner and shared dependency
routing. No new production UI or product permission is introduced.

## 🚦 Execution boundary

This checkpoint permits implementation and feasible local verification only.
Before any further device allocation, the complete committed candidate needs
two independent qualifying reviews, current selected ordinary checks and a
separate finite plan naming its exact source, diagnostic question and full
authored journey. No diagnostic allowance is silently renewed here. If no input
failure recurs, full authored acceptance may pass but the old loss remains
unexplained; a later pass is not retrospective diagnosis. If telemetry cannot
distinguish the paths, record that limit instead of increasing time or replaying
an uncertain input.

Operator receives bounded, redacted evidence; Owner and Collaborator keep real
native editing and complete retained-content guarantees; Link guest authority
and offline exclusion are unchanged. No persona benefits from a synthetic edit
being mislabeled native input.

## ✅ Local implementation checkpoint

The temporary observer retains at most 16 event references per key range, with
sticky overflow and explicit pending-dispatch counts. A final removal read uses
`finally` to remove listeners even when reading fails. Cleanup observations stay
separate from each key's last deadline snapshot, so a late insertion cannot
replace the first failure. Action, removal and recording failures retain their
original precedence; successful input with unavailable observation still fails.

The combined existing acceptance/capability and new observation controls passed
97/97 in 36,157 ms, with a sampled process-tree peak of 751,360 KiB under the
unchanged local watchdog. Scoped TypeScript checking passed in 1,006 ms at
630,560 KiB; scoped warning-denying lint and backlog checks passed. These use
available donor tooling/types, not a full dependency installation or application
acceptance. The initial scoped type check exposed a local inferred-type error;
an explicit trace type repaired it before the passing check. Existing
`scripts/ci/*.test.ts` selection owns the helper controls; this executable path
is outside the documentation-only allowlist. Current selected hosted validation,
two exact-commit reviews and physical acceptance remain pending.

### 🔧 Independent cleanup finding repaired before publication

Review B withheld publication of `30fbfef9` at 94/100: the real diagnosis hook
awaited a screenshot before invoking the removal callback, so a screenshot
failure could leave the temporary recorder installed. The shared hook now runs
its work exactly once even after screenshot failure, preserves both failures if
the work also fails, and restores the original failed command. The typing owner
records removal inside that callback, separately from diagnostic failure. A
successful removal therefore remains visible even if screenshot evidence failed;
the original typing failure still wins. No command retry or deadline is added.

The real-hook integration and existing acceptance/preparation controls passed
32/32 in 6,396 ms at 420,784 KiB. Expanded scoped typing passed in 918 ms at
666,976 KiB and warning-denying lint passed. The first review and repaired-check
receipts are retained alongside the earlier controls. Fresh exact-head grades
are required; this repair does not grant physical or hosted acceptance.
