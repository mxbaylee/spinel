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
undefined initializer. Preserve the historical [scaffold choice](SPN-001.md#legacy-decision-1-react-version),
which expressly allows later reviewed upgrades.

The primary migration reference is the [React 19 upgrade guide](https://react.dev/blog/2024/04/25/react-19-upgrade-guide).
No compatibility shim, peer-check bypass or new rendering abstraction is added.

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
