# Storybook 10.6 dependency updates

## Core before the React/Vite adapter

**2026-10-25 — accepted, agent judgment for the owner's request to merge the
Dependabot PRs individually, hardest first.** Sources: [core PR #172](https://github.com/mxbaylee/spinel/pull/172)
and [adapter PR #168](https://github.com/mxbaylee/spinel/pull/168).

Update core from 10.3.5 to 10.6.2 first. The installed React/Vite adapter,
React renderer and Vite builder at 10.3.5 accept core `^10.3.5`, including
10.6.2. Updating the adapter first would require core `^10.6.2` while the root
still pins 10.3.5. Keeping two independently verified PRs preserves the requested
sequence without an invalid intermediate peer graph. React 19 and Vite 8 remain
within the declared peer ranges. Retain the existing TypeScript 5 API adapter for
Storybook's docgen consumers alongside the application's TypeScript 7 compiler.

[Storybook 10.6.2](https://github.com/storybookjs/storybook/releases/tag/v10.6.2)
patches [GHSA-f2ph-cmg5-wxc8](https://github.com/advisories/GHSA-f2ph-cmg5-wxc8)
and [GHSA-px85-f4q5-jh77](https://github.com/advisories/GHSA-px85-f4q5-jh77).
Preserve its loopback development-server binding and origin restrictions;
Spinel's localhost development command and static CI catalogue need no insecure
compatibility flags. A newer npm audit recommendation alone is not evidence
that this patched release is affected.

Refresh only the directly related esbuild resolution from 0.27.7 to 0.28.2,
including its matching platform binaries. Core 10.6.2 newly accepts `^0.28.0`,
and Vite already accepts that range. This incorporates the
[0.28.1 Windows development-server fix](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)
and the mature [0.28.2 patch](https://github.com/evanw/esbuild/releases/tag/v0.28.2),
published 2026-08-08. No override or additional root dependency is needed.
The unchanged Express-owned body-parser advisory is outside this dependency
tree; this update does not claim that the entire application's audit is clean.

**Persona effects:** the Operator gets patched development tooling and a coherent
locked install; the Owner, Collaborator and Link guest have no intended product,
document or access-boundary change. Full rendering and interaction checks protect
their existing screens and journeys. No new visual design is proposed.

**Verification:** use a clean locked install, inspect the semantic dependency
diff, and require the seven CI gates plus every applicable Storybook build,
rendering and interaction partition at each PR's final head. The PR review records
the committed SHA, actual evidence and independent grade; this note does not
claim pending checks or human visual approval.

The first validation run timed out waiting for Tags after reload; its failure
image showed the document menu closed. Both reload paths could open the header
before native-editor readiness, and now await the same saved/view-only status
already required on first entry. Keep the 90-second test deadline, flaky-test
failure policy, tag persistence and personal-privacy assertions unchanged. This
synchronizes the existing test precondition and changes no production UI behavior.
