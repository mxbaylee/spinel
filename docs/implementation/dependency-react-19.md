# Coordinated React 19 dependency upgrade

**Date/status:** 2026-10-25, accepted implementation choice; merge remains gated on
current-head CI and independent review. **Authority:** Owner asked to merge the
Dependabot PRs individually, starting with the hardest; agent chose the compatible
migration for [PR #169](https://github.com/mxbaylee/spinel/pull/169).

## Question and decision

Dependabot proposed React DOM 19.3.1 and its types 19.3.0 while leaving React 18.3.1
and React types 18.3.31. The proposed DOM peers require React ^19.3.1 and React
types ^19.3.0, so the original pair cannot be installed as a compatible tree.

Options were to retain the whole React 18 baseline or upgrade all four packages
together. Upgrade React and React DOM to 19.3.1 and both type packages to 19.3.0.
Use the configured registry and regenerate the lockfile without forcing or
ignoring peer resolution. The private presence workspace requires the tested
React ^19.3.1 runtime. This does not claim separate continued React 18 support.

Univer 1.1.0 UI/design/presets, Base UI 1.9.0 and Storybook 10.3.5 already declare
React 19-compatible peers in their published metadata. Spinel already uses
`createRoot`, StrictMode and the modern JSX transform. Adapt the three DOM ref
prop types to include null and give the native-editor story ref an explicit
undefined initializer. React 19 also treats `inert` as a boolean DOM prop: pass
`true` for the existing read-only loading/error guard instead of the React 18
empty-string attribute. Preserve the historical [scaffold choice](SPN-001.md#legacy-decision-1-react-version),
which expressly allows later reviewed upgrades.

The primary migration reference is the [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide).
No peer-check bypass or new rendering abstraction is added.

## Native print resize callback repair

The migration exposed a reproducible browser exception during native Sheet
printing. Both development and production failed all three attempts of the
existing export/import test. Instrumented [CI run 40271852866](https://github.com/mxbaylee/spinel/actions/runs/40271852866)
identified `ResizeObserver.getSize` while printing; the test still retained its
PDF-content, import, persistence and no-browser-errors assertions.

The open-source [Univer UI 1.1.0 virtual-list hook](https://github.com/dream-num/univer/blob/v1.1.0/packages/ui/src/views/hooks/virtual-list.ts)
checks the ref when installing an observer, then dereferences it again in each
callback without checking. A queued resize callback can arrive after React has
cleared the ref and before passive cleanup disconnects the observer. Executing
the installed ES and CJS hook regions with that lifecycle reproduces the same
null `clientWidth` exception while ordinary resizing succeeds.

`scripts/dependencies/patch-univer-ui.ts` narrowly repairs both pinned open-source
builds: snapshot the ref inside the callback, return if detached, and read both
dimensions from the captured node. It validates the package version and original
file hashes, accepts its own already-applied repair, and validates both builds
before writing either. Unknown versions or edits fail installation for review.
The existing core repair remains independent; neither helper reads or changes a
Pro package. Apache provenance is retained in the helper and third-party notices.

Regression tests execute the actual installed hook in each format, verify initial
and subsequent attached sizes, deliver a queued callback after ref detachment,
and verify observer cleanup. An unpatched negative control must reproduce the
original failure. Guard tests cover idempotence, unknown bytes/versions and
validation before writes. The full browser export/import test remains the
integration proof; its error diagnostics now preserve the stack and flow phase.

On the next coordinated Univer upgrade, check upstream's current virtual-list
implementation and remove this UI helper, its postinstall command and notices
when the stock hook passes the retained regression. Do not remove it implicitly
while completing SPN-099's separate core cleanup. The Operator accepts this
small, fail-closed maintenance cost so the Owner and Collaborator keep working
print/export flows and Link guests retain their existing scoped interactions.

## Prototype connection disclosure

The current-head Storybook review also caught the prototype dashboard's
connection explanation failing its retained phone and tablet tap journeys in
[run 40272688221](https://github.com/mxbaylee/spinel/actions/runs/40272688221).
The stories rendered successfully, but the manually opened Tooltip did not
display the explanation. Base UI's [documented touch behavior](https://base-ui.com/react/components/tooltip#alternatives-to-tooltips)
disables tooltips for touch and recommends a Popover for a control whose purpose
is to reveal information. Align the prototype `NetworkStatus` with the existing
production `ConnectionStatus` Popover pattern: built-in tap and hover, explicit
keyboard focus, and no forced focus transfer. Keep the copy, styling and retained
tap/Escape assertions. This fixes the observed review interaction without
changing production connection-state or save-status semantics.

## Fresh peer-copy latency observations

[CI run 40273980487](https://github.com/mxbaylee/spinel/actions/runs/40273980487)
passed both native print flows, but its development Doc collaboration test
failed the retained fail-on-flaky gate: the first two complete UI observations
took 1,051 and 1,106 ms against the 1,000 ms limit; the third attempt passed.
These totals include browser-driver navigation, selection and clipboard work,
so they do not isolate a React propagation regression.

Source review found that the Doc helper re-clicked the canvas after both native
inputs were already focused and edited, then read the shared clipboard without
confirming that this peer's asynchronous copy had replaced the previous value.
Use the established native-input focus target and the Sheet test's fresh
sentinel/completion-poll pattern. This prevents the second peer from passing on
the first peer's clipboard data. Keep both actual UI observations, focus and
clipboard waits inside the original clock; retain the strict 1,000 ms limit,
fail-on-flaky policy and all save/reload/selection assertions. Include the first
peer's observation time in a failed latency assertion for diagnosis. Fresh CI,
not this helper change alone, must establish the retained latency requirement.

## Persona effects

- Operator: one coherent locked runtime avoids failed installs and duplicate React
  instances; existing operational checks remain required.
- Owner: Sheet/Doc editing, persistence, history, offline copies and focus behavior
  must continue to work with the new lifecycle semantics.
- Collaborator: concurrent edits, presence, portals and access changes retain their
  regression coverage.
- Link guest: guest navigation, revocation and recovery of pending input must
  remain scoped to the shared document.

## Verification contract

Require clean locked installation, typecheck, all seven CI gates and every
applicable Storybook rendering/interaction partition. Existing native Sheet/Doc,
development/production, save/reload, presence, keyboard/focus, mobile and guest
access checks are the migration regression coverage. Inspect the dependency tree
for incompatible peers or duplicate React runtimes. PR review records the actual
head SHA and results; this decision record alone does not assert passing checks.
