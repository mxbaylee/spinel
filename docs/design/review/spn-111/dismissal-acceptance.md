# SPN-111 banner dismissal acceptance

The owner approved this revision in chat on 2026-10-27 after withholding approval
of the original banners. This supplements the [implementation record](../../../implementation/SPN-111.md)
and supersedes the earlier banner screenshots for final visual acceptance.

## Behavior to verify

The shared production banner has one accessible **Dismiss for now** close control.
Dismissal stores one nonsecret identity and absolute expiry in this tab's
`sessionStorage`, with a maximum life of one hour. Navigation, reload and unchanged
status polls do not renew or remove it. Initial unknown status after reload is not
cancellation. A changed notice, phase or epoch shows the warning again. Confirmed
cancellation or completion clears obsolete state; unrelated storage is untouched.
Blocked browser storage falls back to memory for the current page lifetime and
in-tab navigation. Opener copies or browser restoration may inherit the original
record, but never extend its expiry; subsequent tab changes are independent.

Dismissing a planned notice removes the band. Dismissing active maintenance leaves
a compact phase/status row with Details. Keyboard focus moves to that row, and
Enter reopens the original guidance. Dismissing a planned notice returns focus to
the mounted application shell. Automatic expiry or state changes do not steal
focus. The application and native editor stay mounted. No dismissal changes
server admission, pending queues, document save status or operation authority.

The close target is 44 by 44 pixels, uses the shared Button, and stays outside the
native details summary. Existing theme colors, responsive spacing and expanded
notice guidance are retained. The compact row also marks a last-known status as
reconnecting when the public endpoint is unreachable.

Operator retains current authority and explicit pause/resume control. Owner and
Collaborator can quiet an announcement without hiding pending-work/save status.
Link guests receive the same minimal public notice without operator identity or
recovery details. No account-wide preference, snooze menu or new dependency is
introduced.

## Evidence and merge gate

`src/ui/maintenanceDismissal.test.ts` covers expiry, reload/loading, tab isolation,
opener-copy limits, notice and phase changes, cancellation, blocked storage,
malformed records and scoped cleanup. Production Storybook states cover compact
light/dark/phone presentation, keyboard dismissal/reopening, remount/poll stability,
notice replacement and a new pause resurfacing. Fixture buttons in the journey
stories are explicitly test controls, not proposed application controls.

At publication, ten standalone logic assertion groups passed and five changed/new
TypeScript files passed syntax transpilation. Those local checks used available
Node 22.16.0 and TypeScript 5.8.3, not the repository's pinned toolchain. Hosted
Typecheck and the Storybook build subsequently passed on `d2e5927`; the Lint job
passed dependency/Oxlint checks but found one hook line requiring formatting,
corrected in this follow-up. None of these results is a final independent grade.
Current-head CI, real browser reload/expiry and retained-native-input acceptance,
refreshed visible light/dark/phone screenshots and both independent full-diff
reviews remain required. Existing screenshots are historical, not current approval.

Each of two nonimplementing reviewers must score the same final commit strictly
above 95/100 with no unresolved blockers: scope/acceptance 35, correctness and
access/data integrity 25, verification evidence including UI 20, operations 10,
and maintainability/documentation/over-complexity 10. Assess all four personas
and the complete SPN-111 diff, not only this follow-up. Disclose agent review only.
The implementing session does not claim either independent grade or final
visual approval. The merge gate in `docs/todo/process.md` and the grades
recorded on PR #206 decide when it lands.

## Concurrent-main integration and landing checkpoint

Main advanced to `c604d984a40cd901ff7acd131a9573e6daadc0bb` while this revision was
being published. The integration preserves PR #209's BrowserStack work, CI follow-up
tickets, grooming decisions and ranking changes. Maintenance runtime is unchanged.

The first integration temporarily retained the active ticket. The hosted Pull
request check correctly refused that state: ticket retirement and completion
bookkeeping must be prepared inside a ticket PR, including while it is draft.
This follow-up removes SPN-111, resolves SPN-112's dependency, records SPN-111 in
the current grooming counter and regenerates the 24-ticket index. That prepared
landing state does not claim this draft has merged or its review gates have passed.
The index was rendered using the current ranking/rendering functions after an
exact round trip of the CI-validated main index; the hosted Backlog check remains
the authoritative complete ticket/index validation. No check was weakened.

The concurrent ticket reminder also remains applicable: local process-crash
checks do not establish target-host or power-loss recovery proof. Final-head
hosted CI/Caddy validation and independent review remain mandatory.
