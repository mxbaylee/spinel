# Review a design change

Use a focused human/AI review when a change affects navigation, layout, visual
hierarchy, shared controls, or important empty/error/access states. A small copy
fix needs a small review; a new journey needs its states and transitions examined.
This replaces SPN-060's broad automation proposal. Owner, chat 2026-10-21.

Keep the existing type, unit, browser, contrast and Storybook interaction checks.
They prove specific behavior. A passing capture or a plausible AI opinion does
not prove a design is useful, accessible or implemented in the application.
No model-based CI gate, full-catalog pixel baseline, general axe pass or new
token-lint framework is promised by this runbook. Add a narrow deterministic
regression check when a concrete repeated defect makes one worthwhile.

## Gather the evidence

1. Name the affected task and personas, the ticket's acceptance, the reviewed
   commit and whether this is a proposal fixture or an application route. Read
   the relevant [playbook](README.md), existing behavior and changed code.
2. Capture the changed screen and meaningful states before/after in light, dark
   and phone views; add tablet/intermediate widths when the layout changes there.
   Use the existing Storybook runner and application Playwright flows. Include
   errors, long content and restricted access where relevant. Sample data only.
3. Exercise the affected path: keyboard/focus, touch, navigation back, loading,
   cancellation and recovery as applicable. Record exactly what ran. Check the
   actual canvas/editor when the change affects Univer, not only its shell.

After `npm run build-storybook`, run `npm run screenshots -- <story IDs>` for all
five existing variants, or add `--viewport desktop`, `tablet` or `mobile` for one
partition. Each CI artifact (`design-review-desktop`, `design-review-tablet`,
`design-review-mobile-light`, `design-review-mobile-dark`) contains its own gallery
and manifest. Mobile CI splits the themes; `--viewport mobile --theme light|dark`
reproduces one partition while the default captures both. See
[capture details](redesign.md#review-and-screenshots). Retain the fixed fixture
time, and link the actual artifacts rather than calling captures approved
regression baselines.

## Ask focused questions

One reviewer can cover a small change. For a substantial journey, independent
subagents can take the following perspectives in parallel, then reconcile their
findings against the same evidence. Assign only perspectives the change needs;
three reviews are not a mandatory ceremony. Ask for concrete findings, not
approval of a proposed conclusion.

### Is each addition necessary?

- What task does this control, label, panel or status let someone complete?
- Is that task already served nearby? What breaks if this addition is removed?
- Is the information needed now, or only after an explicit action? Can a simpler
  existing pattern handle it with fewer decisions or less navigation?
- Does it earn its space on a phone as well as a desktop? Can the person return
  to their files or editing context without losing work or their place?
- Which evidence supports the need: the ticket, a reproduced failure, a repeated
  task, or an explicit owner decision? Mark assumptions instead of inventing user
  research. Do not remove save, recovery, access or destructive-action information
  merely to make a screenshot quieter.

### Does the interaction work?

- Is the main action apparent, and are related actions grouped consistently?
- Can keyboard and touch users reach everything, see focus, dismiss overlays and
  return focus to a sensible place? Are names and states understandable without
  relying on color, an icon alone or hover?
- Do loading, errors, long names, retry, empty data and narrow viewports retain
  stable geometry and a clear next step? Does theme switching preserve meaning?
- Do the shared controls, color tokens, spacing and modal title icons follow the
  playbook? Does a departure solve a demonstrated problem?

### Is the behavior and evidence honest?

- Which part is rendered fixture data, and which part is connected to real
  account, storage or editor state? Does the runtime actually use this component?
- Does the UI distinguish connectivity, a local pending edit and a server-confirmed
  save? Is an unavailable feature accidentally presented as ready?
- For Owner, Collaborator, Operator and Link guest, do access changes, disabled
  states and recovery actions respect the existing boundaries? Inapplicable
  personas need a reason, not invented UI. Operators do not gain document access;
  guests do not gain account identity or unrelated navigation.
- What evidence would disprove the claim? Name the missing scenario or test;
  do not infer correctness from an attractive happy-path screenshot.

## Record and resolve findings

For each finding, include the affected screen/state, source or artifact, observed
problem, practical consequence, smallest useful fix, and confidence or missing
evidence. Separate a reproduced failure from a taste preference or hypothesis.
Fix acceptance failures in the same PR. Put separable work in an existing or new
ticket without duplicating ownership, and record why a finding needs no change.

The PR records evidence and dispositions. Existing independent review and owner
visual approval rules in [the backlog process](../todo/process.md) still apply.
The runbook supplies questions and evidence; it does not replace those decisions.

## Worked example: is SPN-042 already finished?

Source review at `a79d981` on 2026-10-21 found a reviewed network icon in
`src/ui/redesign/Mockups.tsx`, but `NetworkStatus` receives only an `offline`
fixture flag. `web/collaboration.ts` still maps SDK synchronization into broad
saved/reconnecting messages, and the application uses `web/OfflineStatus.tsx`.
The approved placement is present in the proposal; runtime connectivity and
resubscription semantics are not established by that fixture.

**Disposition:** keep SPN-042, narrow it to truthful connected/offline/reconnecting
behavior and integration of the approved icon. Keep save geometry and Retry in
SPN-043, with SPN-049 composing the header. A network connection must not imply
durable save. Required implementation evidence: server unreachable while the
browser reports online, connection loss/reconnect and editor resubscription,
accessible explanations, and unchanged editor bounds across those transitions.

This example is a source-and-scope review, not a new browser or assistive-technology
pass. It demonstrates why existing screenshots alone cannot close a runtime
behavior ticket.
